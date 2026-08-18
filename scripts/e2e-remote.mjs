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
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
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

/** 开一条连接，帧收进数组（**分片已重组**）。 */
async function connect(token) {
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
  return { ws, frames, chunks }
}

async function stepConnect(token) {
  console.log("4. WebSocket + 真实的全量重建")
  const { ws, frames, chunks } = await connect(token)
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
  // 分级 replay：宿主要说清楚这一份里**哪些会话带了正文**，
  // 会话侧照着它记「这条不用再补」。缺省（同机 IPC）才是「全都带」。
  // 这一份里它多半是空的——刚开的会话还没落盘；带内容的那份在第 12 步验
  ok("远程那条路一定报 bodies（缺省的含义是「全都带」，只有同机 IPC 才该缺）", Array.isArray(replay?.replay.bodies))
  const last = started[started.length - 1]
  return last === undefined ? undefined : last.thread.id
}

/**
 * 分级 replay 的另一半：预算、只发头、`watch` → `thread` 帧。
 *
 * ## 为什么要往盘上放东西
 *
 * 这个应用**没发过第一句话的会话不落盘**（见 `host/ctx.ts` 的 `uncommitted`），
 * 而这条脚本不会去真跑一轮引擎。于是照原样连过去，磁盘上一条历史都没有，
 * `bodies` 必然是空的——那时候「它是不是数组」这一条等于什么都没验。
 *
 * 所以这里直接往 journal 目录里放两条历史。**这不是造假**：那是一份公开的
 * 落盘格式（一个会话一个 jsonl，一行一条事件），而「这台机器上攒了很多旧会话」
 * 正是分级 replay 唯一要处理的前提。目录路径也不猜——问应用自己要
 *（`window.omni.appInfo()`）。
 */
async function stepScoped(send, token) {
  console.log("8. 分级 replay：预算、只发头、watch → thread 帧")
  const info = await evaluate(send, "window.omni.appInfo().then(s => JSON.stringify(s))")
  const dir = join(info.dataDir, "threads")
  await mkdir(dir, { recursive: true })
  // 大的先写、小的后写：`list()` 按 mtime 倒序，于是「最近写过的」是小的那条。
  // 预算 4000，大的 5000 条——它必然被留下只发头
  await writeFile(join(dir, "e2e-big.jsonl"), fixture("e2e-big", 5000), "utf8")
  await pause(50)
  await writeFile(join(dir, "e2e-small.jsonl"), fixture("e2e-small", 3), "utf8")

  const { ws, frames } = await connect(token)
  ws.send(JSON.stringify({ type: "hello" }))
  await pause(3500)
  const replay = frames.find((f) => f.type === "replay")
  const bodies = replay?.replay.bodies ?? []
  const events = replay?.replay.events ?? []
  ok("**装得下的那条带了正文**", bodies.includes("e2e-small"), bodies.join(" "))
  ok("**超预算的那条只发头**", !bodies.includes("e2e-big"))
  const itemsOf = (id) => events.filter((e) => e.type === "item.started" && e.item.id.startsWith(id)).length
  ok("只发头的那条在全量里真的没有正文", itemsOf("e2e-big") === 0, `big=${itemsOf("e2e-big")} small=${itemsOf("e2e-small")}`)
  ok("但它还在列表里——头是一条不少的", events.some((e) => e.type === "thread.started" && e.thread.id === "e2e-big"))

  const count = () => frames.filter((f) => f.type === "thread").length
  ws.send(JSON.stringify({ type: "watch", threadId: "e2e-small" }))
  await pause(900)
  ok("**已经带了正文的那条不重复补**——这正是分级要省掉的东西", count() === 0)
  ws.send(JSON.stringify({ type: "watch", threadId: "e2e-big" }))
  await pause(2500)
  const patch = frames.find((f) => f.type === "thread")
  ok("**打开只发头的那条，正文补上来了**", patch?.threadId === "e2e-big", `${patch?.events.length ?? 0} 条`)
  ws.send(JSON.stringify({ type: "watch", threadId: "根本没有这条" }))
  await pause(900)
  ok("要一条不存在的会话，不发空帧也不断连接", count() === 1)
  ws.send(JSON.stringify({ type: "ping" }))
  await pause(400)
  ok("连接还活着", frames.some((f) => f.type === "pong"))

  ws.close()
  await rm(join(dir, "e2e-big.jsonl"), { force: true })
  await rm(join(dir, "e2e-small.jsonl"), { force: true })
}

/** 一条会话的落盘历史。格式就是 journal 的：一行一条事件。 */
function fixture(id, items) {
  const thread = {
    id,
    title: id,
    cwd: "/tmp",
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    engineHistory: ["codex"],
  }
  const lines = [
    { type: "thread.started", at: 1, thread },
    { type: "turn.started", at: 1, turn: { id: `${id}-u`, threadId: id, engine: "codex", status: "running", startedAt: 1 } },
  ]
  for (let i = 0; i < items; i += 1) {
    lines.push({
      type: "item.started",
      at: 1,
      item: { id: `${id}-i${i}`, turnId: `${id}-u`, kind: "user_message", at: 1, text: "端到端验收" },
    })
  }
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n"
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
  console.log("12. 吊销当场断开正连着的那条")
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

/** 推送的两个端点。真发一条要有个活的推送服务，那条在 `relay.test.ts` 里验。 */
async function stepPush(token) {
  console.log("9. 推送端点")
  const key = await (await fetch(`${BASE}/api/push/key`)).json()
  ok("公钥拿得到，且是 65 字节的未压缩点", Buffer.from(key.key ?? "", "base64url").length === 65)
  const noAuth = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: "https://x/y", p256dh: "a", auth: "b" }),
  })
  ok("**订阅要带令牌**——谁都能写的话，别人能让 omni 把你的会话标题推到他手机上", noAuth.status === 401)
  const saved = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: "https://push.example.com/x", p256dh: "aaaa", auth: "bbbb" }),
  })
  ok("带了令牌就存下来", saved.status === 200)
  const bad = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: "https://push.example.com/x" }),
  })
  ok("缺字段的订阅回 400——半个订阅推不出去", bad.status === 400)
}

async function stepStatic() {
  console.log("10. 静态页面与安全响应头")
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
  await stepScoped(send, token)
  await stepPush(token)
  await stepStatic()

  console.log("11. 断开之后设备仍在表里（吊销才该消失）")
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
