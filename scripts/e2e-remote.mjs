#!/usr/bin/env node
/**
 * 真 Electron 应用的端到端验收。**单元测试全绿但跑起来不动，靠这一条兜住。**
 *
 * 完整的一条路：CDP 驱动渲染层调 `window.switchback.remote.pair()`（这一步同时验了
 * preload 通道与主进程的处理器）→ 拿配对码换令牌 → 连 WebSocket →
 * 收真实的全量重建（**要重组分片**）→ 发命令 → 看宿主有没有真的动 →
 * 验档位上限 → 喂坏输入看连接活不活。
 *
 * ## 怎么跑
 *
 * ```sh
 * pnpm build:web
 * pnpm --filter @switchback/desktop exec electron-vite build
 * # 用一份**独立的 userData**，别碰你自己那份。里面的 settings.json 要写：
 * #   "remote": { "enabled": true, "port": 17802, "trustedHosts": [], "maxTrust": "auto-edit" }
 * # `SWITCHBACK_DEV_MAXLIVE=1` 是为了造出一条 detached 的会话：新建第二条会把第一条挤下来，
 * # 而它带着**真的引擎句柄**——「接回老会话」那一步验的就是它
 * cd apps/desktop && SWITCHBACK_DEV_MAXLIVE=1 npx electron . --user-data-dir=/tmp/switchback-e2e --remote-debugging-port=9222 &
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
import { fixture } from "./e2e-fixture.mjs"
import { stepScoped } from "./e2e-scoped.mjs"

const CDP = process.env["SWITCHBACK_E2E_CDP"] ?? "http://127.0.0.1:9222"
const BASE = process.env["SWITCHBACK_E2E_BASE"] ?? "http://127.0.0.1:17802"

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
  console.log("1. CDP 驱动渲染层：window.switchback.remote.pair()")
  const status = await evaluate(send, "window.switchback.remote.pair().then(s => JSON.stringify(s))")
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
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/stream`, ["switchback.v1", token])
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
  // **按 id 数，别只数 `thread.started`。** 只发头的那些出的是 `headerOf`——
  // 最后一条 thread 事件，很可能是 `thread.updated`。归约器两者都走
  // `withThread`（照样建出那一行），所以只数 started 会**少报**，
  // 看起来像「分级把会话弄丢了」，而其实一条没少
  const rows = new Set(events.filter((e) => e.type === "thread.started" || e.type === "thread.updated").map((e) => e.thread.id))
  const started = events.filter((e) => e.type === "thread.started")
  ok("全量里带着会话", rows.size > 0, `${rows.size} 条（其中 ${started.length} 条带 started）`)
  // 分级 replay：宿主要说清楚这一份里**哪些会话带了正文**，
  // 会话侧照着它记「这条不用再补」。缺省（同机 IPC）才是「全都带」。
  // 这一份里它多半是空的——刚开的会话还没落盘；带内容的那份在第 12 步验
  ok("远程那条路一定报 bodies（缺省的含义是「全都带」，只有同机 IPC 才该缺）", Array.isArray(replay?.replay.bodies))
  const last = started[started.length - 1]
  return last === undefined ? undefined : last.thread.id
}



/**
 * **老会话接得回来吗。** 手机上绝大多数会话是 detached 的（宿主只留少数几条活的），
 * 而上一版对着它们只把输入框禁掉、写一句「去桌面上点继续」——
 * 那等于把这一端做成只读，而用户原话是「老会话也能继续 work」。
 *
 * **这里验的是确定性的那一半**：命令过得了远程策略、并且**失败时说得出人话**。
 * 「接回来之后真的能接着跑」需要一条带真引擎句柄的会话，而那要真跑一轮引擎
 *（没发过话的会话不落盘、也没有句柄），这条脚本不做那件事。
 * 这条 fixture 没有引擎句柄，所以宿主必然接不回来——**要紧的是它说出来了**。
 * 点了「接回来」而屏幕上什么都不发生，是这一端最坏的失败方式
 */
async function stepResume(send, token) {
  console.log("8. 老会话接回引擎")
  const dir = join((await evaluate(send, "window.switchback.appInfo().then(s => JSON.stringify(s))")).dataDir, "threads")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "e2e-old.jsonl"), fixture("e2e-old", 2000), "utf8")
  const { ws: ws2, frames: f2 } = await connect(token)
  ws2.send(JSON.stringify({ type: "hello" }))
  await pause(2500)
  const seen = f2.find((f) => f.type === "replay")?.replay.events ?? []
  const old = seen.filter((e) => e.type === "thread.updated" && e.thread.id === "e2e-old").at(-1)?.thread
  ok("**磁盘上的老会话进得了列表，并且标着 detached**", old?.detached === true, `detached=${String(old?.detached)}`)

  ws2.send(JSON.stringify({ type: "command", command: { type: "thread.resume", threadId: "e2e-old" } }))
  await pause(2500)
  const said = f2
    .filter((f) => f.type === "events")
    .flatMap((f) => f.sealed.map((s) => s.event))
    .concat(f2.filter((f) => f.type === "notice").map((f) => ({ type: "notice", detail: f.text })))
  const spoke = said.find((e) => (e.type === "engine.status" && e.status === "crashed") || e.type === "notice")
  ok("**这条命令没被策略挡下**（挡下会回一条 notice 说被拒）", said.length > 0, `收到 ${String(said.length)} 条`)
  ok("**接不回来时说得出为什么**，而不是点了没反应", spoke !== undefined, String(spoke?.detail ?? "").slice(0, 60))
  ws2.close()
  await rm(join(dir, "e2e-old.jsonl"), { force: true })

}

async function stepCommands({ ws, frames, target }, send, token) {
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

  // **这一条是用户最早提的要求原话**：「并且能继续开新对话进行开发」。
  // 上一版整个没做（界面上没有入口），理由是「新建要选目录」——
  // 而手机根本不需要文件浏览器：已经在用的那些项目就是清单。
  //
  // **排在档位那一步之后**：新建会把那条没人用过的临时会话回收掉
  //（`host` 的「没用过就不留痕」），排在前面的话后面那步就没有目标了
  console.log("7. 从远程开一条新会话")
  const before = new Set(events().filter((e) => e.type === "thread.started").map((e) => e.thread.id))
  ws.send(
    JSON.stringify({
      type: "command",
      command: { type: "thread.create", cwd: process.cwd(), engine: "codex", trust: "auto-edit" },
    }),
  )
  await pause(2500)
  const born = events().filter((e) => e.type === "thread.started" && !before.has(e.thread.id))
  ok("**手机开得出新会话**", born.length === 1, born[0]?.thread.title ?? "(一条都没建出来)")
  ok("开在指定的工作区", born[0]?.thread.cwd === process.cwd(), born[0]?.thread.cwd)
  ok("档位是远程上限那一档", born[0]?.thread.trust === "auto-edit", born[0]?.thread.trust)

  await stepResume(send, token)

  console.log("9. 坏输入不掀翻连接")
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
  console.log("14. 吊销当场断开正连着的那条")
  const status = await evaluate(send, "window.switchback.remote.pair().then(s => JSON.stringify(s))")
  const paired = await (
    await fetch(`${BASE}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: status.pairing.code, name: "要被吊销的" }),
    })
  ).json()
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/stream`, ["switchback.v1", paired.token])
  const closed = { code: 0 }
  ws.on("close", (code) => {
    closed.code = code
  })
  await new Promise((r, j) => {
    ws.once("open", r)
    ws.once("error", j)
  })
  ok("连上了", ws.readyState === WebSocket.OPEN)
  const list = await evaluate(send, "window.switchback.remote.status().then(s => JSON.stringify(s))")
  const victim = list.devices.find((d) => d.name === "要被吊销的")
  await evaluate(send, `window.switchback.remote.revoke(${JSON.stringify(victim.id)}).then(s => JSON.stringify(s))`)
  await pause(800)
  ok("**那条连接当场断了**", ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING, `code ${String(closed.code)}`)
  const me = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${paired.token}` } })
  ok("令牌之后也认不出", me.status === 401)
}

/** 推送的两个端点。真发一条要有个活的推送服务，那条在 `relay.test.ts` 里验。 */
async function stepPush(token) {
  console.log("11. 推送端点")
  const key = await (await fetch(`${BASE}/api/push/key`)).json()
  ok("公钥拿得到，且是 65 字节的未压缩点", Buffer.from(key.key ?? "", "base64url").length === 65)
  const noAuth = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: "https://x/y", p256dh: "a", auth: "b" }),
  })
  ok("**订阅要带令牌**——谁都能写的话，别人能让 Switchback 把你的会话标题推到他手机上", noAuth.status === 401)
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
  console.log("12. 静态页面与安全响应头")
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
  await stepCommands(conn, send, token)
  await stepScoped(send, token, { evaluate, connect, ok, pause })
  await stepPush(token)
  await stepStatic()

  console.log("13. 断开之后设备仍在表里（吊销才该消失）")
  conn.ws.close()
  await pause(800)
  const after = await evaluate(send, "window.switchback.remote.status().then(s => JSON.stringify(s))")
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
