#!/usr/bin/env node
/**
 * 真 Electron 应用的端到端验收。**单元测试全绿但跑起来不动，靠这一条兜住。**
 *
 * 完整的一条路：CDP 驱动渲染层调 `window.omni.remote.pair()`（这一步同时验了
 * preload 通道与主进程的处理器）→ 拿配对码换令牌 → 连 WebSocket →
 * 收真实的全量重建（**要重组分片**）→ 发命令 → 看宿主有没有真的动 →
 * 验档位上限 → 喂坏输入看连接活不活。
 *
 * ## 怎么跑
 *
 * ```sh
 * pnpm build:web
 * pnpm --filter @omni/desktop exec electron-vite build
 * # 用一份**独立的 userData**，别碰你自己那份。里面的 settings.json 要写：
 * #   "remote": { "enabled": true, "port": 17802, "trustedHosts": [], "maxTrust": "auto-edit" }
 * cd apps/desktop && npx electron . --user-data-dir=/tmp/omni-e2e --remote-debugging-port=9222 &
 * node scripts/e2e-remote.mjs
 * ```
 *
 * ## 为什么不做成 vitest
 *
 * 它要的是一个真的 Electron 进程、一次真的引擎探测、一份真的磁盘历史。
 * 塞进单元测试只会得到一堆桩，而桩只会照着我们以为的样子回答——
 * 这条脚本存在的全部意义正是「我们以为的」和「它实际做的」不一样。
 * 实测逮到过：全量重建**确实**发出去了，只是被切成两片，而只看 `type` 的
 * 客户端会以为一条都没收到。
 */
import WebSocket from "ws"

const CDP = process.env["OMNI_E2E_CDP"] ?? "http://127.0.0.1:9222"
const BASE = process.env["OMNI_E2E_BASE"] ?? "http://127.0.0.1:17802"

const state = { failed: 0 }
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${extra === "" ? "" : ` — ${extra}`}`)
  if (!cond) state.failed += 1
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** 分片重组。**这一步不能省**：一次全量重建实测 24 KB，会被切成两片。 */
function reassembler() {
  const acc = { id: -1, parts: [], count: 0 }
  return (text) => {
    const frame = JSON.parse(text)
    if (frame.type !== "chunk") return frame
    if (frame.id !== acc.id) {
      acc.id = frame.id
      acc.parts = []
      acc.count = frame.count
    }
    acc.parts.push(frame.body)
    if (acc.parts.length < acc.count) return undefined
    const whole = JSON.parse(acc.parts.join(""))
    acc.id = -1
    return whole
  }
}

function rpcClient(socket) {
  const inner = { id: 0, waiting: new Map() }
  socket.on("message", (raw) => {
    const msg = JSON.parse(String(raw))
    const p = inner.waiting.get(msg.id)
    if (p === undefined) return
    inner.waiting.delete(msg.id)
    if (msg.error) p.fail(new Error(JSON.stringify(msg.error)))
    else p.done(msg.result)
  })
  return (method, params = {}) =>
    new Promise((done, fail) => {
      inner.id += 1
      inner.waiting.set(inner.id, { done, fail })
      socket.send(JSON.stringify({ id: inner.id, method, params }))
    })
}

/** 在渲染层里跑一段 JS 并把 JSON 结果带回来。 */
async function evaluate(send, expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true })
  return JSON.parse(res.result.value)
}

async function stepPair(send) {
  console.log("1. CDP 驱动渲染层：window.omni.remote.pair()")
  const status = await evaluate(send, "window.omni.remote.pair().then(s => JSON.stringify(s))")
  ok("preload → 主进程的 remote/pair 通道通了", typeof status.pairing?.code === "string", status.pairing?.code)
  ok("状态报的是真在听", status.listening === true, `port ${status.port}`)

  console.log("2. 配对码换令牌")
  const paired = await (
    await fetch(`${BASE}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: status.pairing.code, name: "端到端验收" }),
    })
  ).json()
  ok("换到令牌", typeof paired.token === "string")

  console.log("3. /api/me 认得出这台设备")
  const me = await (await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${paired.token}` } })).json()
  ok("认得出", me.name === "端到端验收", `远程上限 ${me.maxTrust}`)
  ok("假令牌回 401", (await fetch(`${BASE}/api/me`, { headers: { authorization: "Bearer not-real" } })).status === 401)
  return paired.token
}

async function stepConnect(token) {
  console.log("4. WebSocket + 真实的全量重建")
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/stream`, ["omni.v1", token])
  const frames = []
  const observe = reassembler()
  const chunks = { n: 0 }
  ws.on("message", (d) => {
    const text = String(d)
    if (text.includes('"type":"chunk"')) chunks.n += 1
    const frame = observe(text)
    if (frame !== undefined) frames.push(frame)
  })
  await new Promise((r, j) => {
    ws.once("open", r)
    ws.once("error", j)
  })
  ok("握手成功（子协议里带令牌）", true)
  ws.send(JSON.stringify({ type: "hello" }))
  await pause(2500)
  return { ws, frames, target: checkReplay(frames, chunks.n) }
}

/** 全量里该有什么。返回最后一条会话的 id，供后面的命令用。 */
function checkReplay(frames, chunkCount) {
  const replay = frames.find((f) => f.type === "replay")
  const events = replay === undefined ? [] : replay.replay.events
  ok("收到全量重建", replay !== undefined, `${events.length} 条事件，走了 ${chunkCount} 个分片`)
  const engines = events.find((e) => e.type === "engines.available")
  const names = engines === undefined ? "" : engines.engines.map((e) => `${e.id}=${e.state}`).join(" ")
  ok("全量里带着引擎清单", engines !== undefined, names)
  const started = events.filter((e) => e.type === "thread.started")
  ok("全量里带着会话", started.length > 0, `${started.length} 条`)
  const last = started[started.length - 1]
  return last === undefined ? undefined : last.thread.id
}

async function stepCommands({ ws, frames, target }) {
  const events = () =>
    frames
      .filter((f) => f.type === "events")
      .flatMap((f) => f.sealed)
      .map((s) => s.event)

  console.log("5. 发命令 → 宿主真的动了")
  ws.send(JSON.stringify({ type: "command", command: { type: "thread.rename", threadId: target, title: "手机改的名字" } }))
  await pause(1500)
  ok(
    "改名生效并推了回来",
    events().some((e) => e.type === "thread.renamed" && e.title === "手机改的名字"),
  )

  console.log("6. 档位上限在服务端生效（浏览器改 JS 绕不过去）")
  ws.send(JSON.stringify({ type: "command", command: { type: "thread.setTrust", threadId: target, trust: "full" } }))
  await pause(1500)
  const updated = events()
    .filter((e) => e.type === "thread.updated" && e.thread.id === target)
    .at(-1)
  ok("要 full 被钳成 auto-edit", updated?.thread?.trust === "auto-edit", `实际 ${updated?.thread?.trust}`)

  console.log("7. 坏输入不掀翻连接")
  ws.send("{不是 JSON")
  ws.send(JSON.stringify({ type: "command", command: { type: "rm -rf", threadId: target } }))
  ws.send(JSON.stringify({ type: "从未来来的帧" }))
  await pause(800)
  ok("连接还活着", ws.readyState === WebSocket.OPEN)
  ws.send(JSON.stringify({ type: "ping" }))
  await pause(600)
  ok(
    "还能应答",
    frames.some((f) => f.type === "pong"),
  )
}

/**
 * **吊销要当场掐断正连着的那条。**
 *
 * 只删记录的话，一台没断线的设备永远等不到「下一次连接」——它继续收全部事件、
 * 继续能替你放行 agent 要跑的每一条命令。而按下那颗按钮的场景恰恰是「手机丢了」。
 */
async function stepRevoke(send) {
  console.log("10. 吊销当场断开正连着的那条")
  const status = await evaluate(send, "window.omni.remote.pair().then(s => JSON.stringify(s))")
  const paired = await (
    await fetch(`${BASE}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: status.pairing.code, name: "要被吊销的" }),
    })
  ).json()
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/stream`, ["omni.v1", paired.token])
  const closed = { code: 0 }
  ws.on("close", (code) => {
    closed.code = code
  })
  await new Promise((r, j) => {
    ws.once("open", r)
    ws.once("error", j)
  })
  ok("连上了", ws.readyState === WebSocket.OPEN)
  const list = await evaluate(send, "window.omni.remote.status().then(s => JSON.stringify(s))")
  const victim = list.devices.find((d) => d.name === "要被吊销的")
  await evaluate(send, `window.omni.remote.revoke(${JSON.stringify(victim.id)}).then(s => JSON.stringify(s))`)
  await pause(800)
  ok("**那条连接当场断了**", ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING, `code ${String(closed.code)}`)
  const me = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${paired.token}` } })
  ok("令牌之后也认不出", me.status === 401)
}

async function stepStatic() {
  console.log("8. 静态页面与安全响应头")
  const home = await fetch(`${BASE}/`)
  ok("首页 200", home.status === 200, home.headers.get("content-type"))
  ok("带了 CSP", (home.headers.get("content-security-policy") ?? "").includes("default-src 'self'"))
  ok("带了 nosniff", home.headers.get("x-content-type-options") === "nosniff")
}

async function main() {
  const list = await (await fetch(`${CDP}/json/list`)).json()
  const page = list.find((t) => t.type === "page")
  const cdp = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => cdp.once("open", r))
  const send = rpcClient(cdp)
  await send("Runtime.enable")

  const token = await stepPair(send)
  const conn = await stepConnect(token)
  await stepCommands(conn)
  await stepStatic()

  console.log("9. 断开之后设备仍在表里（吊销才该消失）")
  conn.ws.close()
  await pause(800)
  const after = await evaluate(send, "window.omni.remote.status().then(s => JSON.stringify(s))")
  ok(
    "设备表里有这一台",
    after.devices.some((d) => d.name === "端到端验收"),
  )

  await stepRevoke(send)

  cdp.close()
  console.log(state.failed === 0 ? "\n全部通过" : `\n有 ${state.failed} 项失败`)
  process.exit(state.failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
