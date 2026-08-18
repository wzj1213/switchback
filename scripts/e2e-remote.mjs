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
import { fixture } from "./e2e-fixture.mjs"

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
 * 分级 replay：字节预算、只发头、`watch` → `thread` 帧。
 *
 * ## 为什么要往盘上放东西
 *
 * 这个应用**没发过第一句话的会话不落盘**（见 `host/ctx.ts` 的 `uncommitted`），
 * 而这条脚本不会去真跑一轮引擎。于是照原样连过去，磁盘上一条历史都没有，
 * `bodies` 必然是空的——那时候「它是不是数组」这一条等于什么都没验。
 *
 * ## 为什么样本要按**字节**造
 *
 * 第一版这里造的是「5000 条极小的事件」，因为当时预算卡的是条数。
 * 而真机上栽的恰恰是另一头：**九条会话才 3291 条事件，合起来 5.2 MB**——
 * 条数远低于阈值，字节大两个数量级，于是九条全带正文、切成 271 个分片、
 * 手机上一片空白。所以这里的样本必须是「事件不多但每条很大」的那种形状。
 */
async function stepScoped(send, token) {
  console.log("9. 分级 replay：大小预算、只发头、watch → thread 帧")
  const info = await evaluate(send, "window.omni.appInfo().then(s => JSON.stringify(s))")
  const dir = join(info.dataDir, "threads")
  await mkdir(dir, { recursive: true })
  // 六条各约 10 万码元。单条封顶 64K、整份预算 192K，所以最近那两三条带
  //（裁过的）正文，更早的必然只发头。**先写的 mtime 早**，于是 t6 最新
  const ids = ["e2e-t1", "e2e-t2", "e2e-t3", "e2e-t4", "e2e-t5", "e2e-t6"]
  for (const id of ids) {
    await writeFile(join(dir, `${id}.jsonl`), fixture(id, 100_000), "utf8")
    await pause(30)
  }

  const { ws, frames } = await connect(token)
  ws.send(JSON.stringify({ type: "hello" }))
  await pause(3500)
  const replay = frames.find((f) => f.type === "replay")
  const bodies = replay?.replay.bodies ?? []
  const events = replay?.replay.events ?? []
  const mine = ids.filter((id) => bodies.includes(id))
  const deferred = ids.filter((id) => !bodies.includes(id))
  ok("**最近那几条带正文**", mine.includes("e2e-t6"), mine.join(" "))
  ok("**更早的只发头**——判据是大小，不是条数", deferred.length > 0, `留下 ${deferred.length} 条`)

  const itemsOf = (id) => events.filter((e) => e.type === "item.started" && e.item.id.startsWith(`${id}-`)).length
  const cold = deferred[0]
  ok("只发头的那条在全量里真的没有正文", itemsOf(cold) === 0, `${cold} → ${itemsOf(cold)} 条`)
  ok("但它还在列表里——头是一条不少的", events.some((e) => (e.type === "thread.started" || e.type === "thread.updated") && e.thread.id === cold))
  ok(
    "**带正文的那条也被裁过**——一条 2.5 MB 的会话足以把整份预算架空",
    itemsOf("e2e-t6") > 0 && itemsOf("e2e-t6") < 100_000 / 1600,
    `e2e-t6 → ${itemsOf("e2e-t6")} 条`,
  )

  const count = () => frames.filter((f) => f.type === "thread").length
  ws.send(JSON.stringify({ type: "watch", threadId: "e2e-t6" }))
  await pause(900)
  ok("**已经带了正文的那条不重复补**——这正是分级要省掉的东西", count() === 0)
  ws.send(JSON.stringify({ type: "watch", threadId: cold }))
  await pause(2500)
  const patch = frames.find((f) => f.type === "thread")
  ok("**打开只发头的那条，正文补上来了**", patch?.threadId === cold, `${patch?.events.length ?? 0} 条`)
  ws.send(JSON.stringify({ type: "watch", threadId: "根本没有这条" }))
  await pause(900)
  ok("要一条不存在的会话，不发空帧也不断连接", count() === 1)
  ws.send(JSON.stringify({ type: "ping" }))
  await pause(400)
  ok("连接还活着", frames.some((f) => f.type === "pong"))

  ws.close()
  for (const id of ids) await rm(join(dir, `${id}.jsonl`), { force: true })
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

  console.log("8. 坏输入不掀翻连接")
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
  console.log("13. 吊销当场断开正连着的那条")
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
  console.log("10. 推送端点")
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
  console.log("11. 静态页面与安全响应头")
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

  console.log("12. 断开之后设备仍在表里（吊销才该消失）")
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
