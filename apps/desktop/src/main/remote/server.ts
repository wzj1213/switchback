import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocketServer, type WebSocket } from "ws"
import type { Command, Event, Trust } from "@omni/protocol"
import type { Ledger } from "@omni/wire"
import type { Sink, Sinks } from "../sink.js"
import { checkRequest, headersOf } from "./fence.js"
import { createSession } from "./session.js"
import { serveStatic } from "./static.js"
import type { TokenStore } from "./tokens.js"

/**
 * 远程服务端。
 *
 * ## 只 listen 回环
 *
 * 唯一的入口是你自己开的隧道（`ssh -R`）。咖啡馆的 wifi 上扫不到任何东西，
 * 也没有一个「不小心绑到 0.0.0.0」的开关可按。
 *
 * 但**绑回环不等于安全**——浏览器可以被 DNS 改绑骗着替攻击者访问本机。
 * 那一层由 `fence.ts` 挡（每个请求都查 `Host`）。两层都要过：
 * 闸回答「这个请求是不是冲着我们来的」，令牌回答「你是谁」。
 */

export const WS_PATH = "/api/stream"
export const WS_PROTOCOL = "omni.v1"

/** 配对请求的体积上限。它只有两个短字段，给这么多已经是宽的。 */
const MAX_BODY = 4096

export interface RemoteConfig {
  port: number
  /** 隧道那头对外的 authority（`omni.example.com:8443`）。空 = 只认回环。 */
  trustedHosts: readonly string[]
  /** 远程连接的档位上限。 */
  maxTrust: Trust
}

export interface RemoteDeps {
  config: () => RemoteConfig
  /** 推送用的公钥（base64url 的未压缩点）。前端拿它做 `applicationServerKey`。 */
  pushKey: () => string
  /** 浏览器端构建产物所在目录。目录不在就只有 API，没有页面——**不假装有**。 */
  webRoot: string
  tokens: TokenStore
  ledger: Ledger
  sinks: Sinks
  dispatch: (command: Command) => void
  replay: (sink: Sink) => Promise<void>
  /** 某条会话现在是哪一档。档位上限靠它才管得住已经开着的会话。 */
  trustOf: (threadId: string) => Trust | undefined
  /** 一条会话的历史。分级 replay 的另一半——客户端打开哪条就补哪条。 */
  history: (threadId: string) => Promise<readonly Event[]>
  /**
   * 死连接的判定节奏。**只有测试会传**——真跑时用下面那两个常量。
   *
   * 不做成常量直接读，是因为默认值是 20 秒 / 50 秒：照原速测一次要将近一分钟，
   * 而那样的测试没人会跑第二遍，最后就变成没有测试。
   */
  heartbeat?: { everyMs: number; deadAfterMs: number }
  log: (level: "info" | "warn" | "error", message: string) => void
}

export interface RemoteServer {
  /** 实际监听的端口（配 0 时由系统分配）。 */
  port: () => number
  /**
   * 把某台设备**现在连着的**那些连接掐掉，返回掐了几条。
   *
   * ## 为什么吊销必须做这一步
   *
   * `tokens.revoke()` 只是把记录从表里删掉——已经握手完成的 WebSocket
   * **不会因此断开**：它照旧收全部事件、照旧能发 `approval.resolve`。
   * 而按下那颗「吊销」按钮的场景恰恰是「手机丢了」，此时那台设备很可能
   * 正连着。只删记录等于**按了没用**，而界面上写着已经吊销。
   */
  disconnect: (deviceId: string) => number
  close: () => Promise<void>
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  res.end(text)
}

/** 读请求体，超过上限就掐断。**不 buffer 无限大的东西**。 */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) return undefined
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** `Authorization: Bearer xxx` 里的令牌。 */
function bearer(req: IncomingMessage): string {
  const raw = req.headers.authorization
  return typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7) : ""
}

/** WebSocket 握手时令牌走子协议：浏览器的 `WebSocket` 构造器设不了请求头。 */
function protocolToken(req: IncomingMessage): string {
  const raw = req.headers["sec-websocket-protocol"]
  const parts = (typeof raw === "string" ? raw : "").split(",").map((s) => s.trim())
  return parts[0] === WS_PROTOCOL ? (parts[1] ?? "") : ""
}

async function handlePair(deps: RemoteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  if (body === undefined) {
    json(res, 413, { error: "请求体过大" })
    return
  }
  const parsed = safeParse(body)
  const code = typeof parsed?.["code"] === "string" ? parsed["code"] : ""
  const name = typeof parsed?.["name"] === "string" ? parsed["name"] : ""
  const claimed = deps.tokens.claim(code, name)
  if (!claimed.ok) {
    deps.log("warn", `配对失败：${claimed.reason}`)
    json(res, 403, { error: claimed.reason })
    return
  }
  deps.log("info", `新设备配对成功：${claimed.device.name}（${claimed.device.id}）`)
  json(res, 200, { token: claimed.token, device: { id: claimed.device.id, name: claimed.device.name } })
}

/**
 * 记下一台设备的推送订阅。
 *
 * **要带令牌**：订阅是「往这台设备推」的凭据，谁都能写的话，
 * 任何人都能让 omni 把你的会话标题推到他自己的手机上。
 */
async function handleSubscribe(deps: RemoteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const device = deps.tokens.verify(bearer(req))
  if (device === undefined) {
    json(res, 401, { error: "unauthorized" })
    return
  }
  const body = await readBody(req)
  if (body === undefined) {
    json(res, 413, { error: "请求体过大" })
    return
  }
  const parsed = safeParse(body ?? "")
  // 传 null 表示退订。三个字段缺一不可——半个订阅推不出去，留着只会每次白发一次请求
  if (parsed?.["endpoint"] === undefined) {
    deps.tokens.setPush(device.id, undefined)
    deps.log("info", `${device.name} 取消了推送`)
    json(res, 200, { ok: true })
    return
  }
  const endpoint = parsed["endpoint"]
  const p256dh = parsed["p256dh"]
  const auth = parsed["auth"]
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    json(res, 400, { error: "订阅的形状不对" })
    return
  }
  deps.tokens.setPush(device.id, { endpoint, p256dh, auth })
  deps.log("info", `${device.name} 开了推送`)
  json(res, 200, { ok: true })
}

function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 被闸门拦下时给人的那句话。**指向要改的那一栏**，而不是只说「被拒了」。 */
const FENCE_HINT = "在那台 Mac 上打开 omni → 设置 → 远程访问，把「隧道那头的域名」填成你现在地址栏里的 host[:端口]（不要带 https://）"

function route(deps: RemoteDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const verdict = checkRequest(headersOf(req.headers), deps.config().trustedHosts)
    if (!verdict.ok) {
      deps.log("warn", `拦下一个请求：${verdict.reason}`)
      // **把理由说出来。** 之前这里只回一个 `{"error":"forbidden"}`——
      // 而人在手机上看到的就是「Forbidden」四个字母，没有任何线索指向
      // 「桌面那台上域名那一栏填错了」。这段话不泄露任何东西：
      // 对面已经知道自己被拦了，也已经知道自己用的是哪个 Host
      json(res, 403, { error: "forbidden", reason: verdict.reason, hint: FENCE_HINT })
      return
    }
    const path = (req.url ?? "/").split("?")[0] ?? "/"
    if (path === "/api/pair" && req.method === "POST") {
      void handlePair(deps, req, res).catch((error: unknown) => {
        deps.log("error", `配对处理失败：${String(error)}`)
        json(res, 500, { error: "internal" })
      })
      return
    }
    if (path === "/api/me") {
      const device = deps.tokens.verify(bearer(req))
      if (device === undefined) json(res, 401, { error: "unauthorized" })
      else json(res, 200, { id: device.id, name: device.name, maxTrust: deps.config().maxTrust })
      return
    }
    if (path === "/api/push/key") {
      // **公钥不需要令牌**：它本来就是要发给客户端的东西，
      // 而 `PushManager.subscribe()` 得先拿到它才能生成订阅
      json(res, 200, { key: deps.pushKey() })
      return
    }
    if (path === "/api/push/subscribe" && req.method === "POST") {
      void handleSubscribe(deps, req, res).catch((error: unknown) => {
        deps.log("error", `处理推送订阅失败：${String(error)}`)
        json(res, 500, { error: "internal" })
      })
      return
    }
    if (path === WS_PATH) {
      // 普通 GET 打到这条路径上：明说要升级，不退化成别的东西
      json(res, 426, { error: "这条路径只接受 WebSocket 升级" })
      return
    }
    void serveStatic(deps.webRoot, path, res, req).then((result) => {
      if (!result.ok && result.reason !== undefined) deps.log("info", `静态：${result.reason}`)
    })
  }
}

/** 握手就拒。**在协议协商之前**——不要先建起一条连接再说不行。 */
function reject(socket: Duplex, code: number, text: string): void {
  socket.end(
    [`HTTP/1.1 ${String(code)} ${text}`, "connection: close", "content-length: 0", "", ""].join("\r\n"),
  )
}

/**
 * 多久扫一次死连接，以及多久没动静算死。
 *
 * 客户端每 15 秒 ping 一次，所以 50 秒 = 连丢三轮。给得比 3×15 松一点，
 * 是因为手机在弱网下 ping 会挤在一起到——判早了会把一条还活着的连接踢掉，
 * 而它重连时要走一次全量。
 */
const HEARTBEAT_MS = 20_000
const DEAD_AFTER_MS = 50_000

/** 一条刚握完手的连接要接上的东西。 */
interface Attach {
  deps: RemoteDeps
  ws: WebSocket
  /** 会话身份（账本按它记确认位）。 */
  id: string
  /** 设备 id → 它现在连着的那些 socket。吊销时要按它掐。 */
  live: Map<string, Set<WebSocket>>
  deviceId: string
}

function attachSocket({ deps, ws, id, live, deviceId }: Attach): void {
  const session = createSession({
    id,
    send: (text) => {
      ws.send(text)
    },
    close: (code, reason) => {
      ws.close(code, reason)
    },
    buffered: () => ws.bufferedAmount,
    ledger: deps.ledger,
    dispatch: deps.dispatch,
    replay: deps.replay,
    ceiling: () => deps.config().maxTrust,
    trustOf: deps.trustOf,
    history: deps.history,
    log: deps.log,
  })
  const detach = deps.sinks.add(session.sink)
  const bucket = live.get(deviceId) ?? new Set<WebSocket>()
  bucket.add(ws)
  live.set(deviceId, bucket)
  const seen = { at: Date.now() }
  ws.on("message", (data) => {
    seen.at = Date.now()
    session.receive(String(data))
  })
  // **半开的连接必须自己发现。** 手机进电梯、切飞行模式，TCP 那侧不会立刻断——
  // 这条 socket 会以「还连着」的样子挂上几十分钟，而那期间：
  // ① 它 `watching` 的那条会话的推送**全被当成「有人正看着」抑制掉**，
  //    也就是你最需要的那条通知恰好不会响；
  // ② 账本的保留下限被它钉住，别的客户端的补洞缓冲跟着涨；
  // ③ 每条事件照样往它的发送缓冲里塞，直到 8 MB 那道背压闸。
  // 判据用「多久没收到任何一帧」：客户端本来就每 15 秒 ping 一次（`web/transport.ts`），
  // 所以静默超过三轮就是真没了，不用另发探测帧
  const beat = deps.heartbeat ?? { everyMs: HEARTBEAT_MS, deadAfterMs: DEAD_AFTER_MS }
  const heartbeat = setInterval(() => {
    if (Date.now() - seen.at < beat.deadAfterMs) return
    deps.log("info", `${id} 超过 ${String(Math.round(beat.deadAfterMs / 1000))} 秒没动静，判死`)
    ws.terminate()
  }, beat.everyMs)
  const bye = (): void => {
    clearInterval(heartbeat)
    // **第一句就置死。** 后面那些摘除都可以晚一点，而 `alive()` 判错的代价
    // 是往一个已经关掉的连接上同步序列化几十 MB
    session.stop()
    detach()
    bucket.delete(ws)
    if (bucket.size === 0) live.delete(deviceId)
    // **必须摘掉**，否则一个断开的客户端会永久钉住账本的保留下限
    deps.ledger.leave(id)
  }
  ws.once("close", bye)
  ws.once("error", (error) => {
    deps.log("warn", `${id} 连接出错：${String(error)}`)
    bye()
  })
}

function upgrade(deps: RemoteDeps, wss: WebSocketServer, counter: { n: number }, live: Map<string, Set<WebSocket>>) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const verdict = checkRequest(headersOf(req.headers), deps.config().trustedHosts)
    if (!verdict.ok) {
      deps.log("warn", `拦下一次升级：${verdict.reason}`)
      reject(socket, 403, "Forbidden")
      return
    }
    if (((req.url ?? "").split("?")[0] ?? "") !== WS_PATH) {
      reject(socket, 404, "Not Found")
      return
    }
    const device = deps.tokens.verify(protocolToken(req))
    if (device === undefined) {
      deps.log("warn", "拦下一次升级：令牌认不出")
      reject(socket, 401, "Unauthorized")
      return
    }
    counter.n += 1
    const id = `remote-${device.id}-${String(counter.n)}`
    wss.handleUpgrade(req, socket, head, (ws) => {
      deps.log("info", `${device.name} 连上了（${id}）`)
      attachSocket({ deps, ws, id, live, deviceId: device.id })
    })
  }
}

export function startRemote(deps: RemoteDeps): Promise<RemoteServer> {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: () => WS_PROTOCOL,
    // **压缩。** `ws` 默认是关的（它担心的是几万条连接时每条一份 zlib 上下文的内存），
    // 而这一端同时连着的是「你的几台设备」，那个担心不成立。
    // 事件流是高度重复的 JSON，实测压缩比 3.8×——一份全量从 14 个分片降到 4 个左右。
    //
    // `threshold` 是关键：一条 `item.delta` 只有几十字节，压它纯是烧 CPU，
    // 还会因为 deflate 的固定开销变大。只压值得压的。
    perMessageDeflate: {
      threshold: 1024,
      // 别把上下文留在连接上（`clientNoContextTakeover`）：跨消息的字典能再省一点，
      // 但代价是每条连接常驻一份滑动窗口。这一端的大头是**一次性的那份全量**，
      // 它自己就够大到压得动，不需要靠跨消息字典
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
    },
  })
  const server: Server = createServer(route(deps))
  /** 设备 id → 它现在连着的那些 socket。吊销时要按它掐。 */
  const live = new Map<string, Set<WebSocket>>()
  server.on("upgrade", upgrade(deps, wss, { n: 0 }, live))
  return new Promise((done, fail) => {
    server.once("error", fail)
    // **只绑回环。** 这里没有可配的 host——一个能被改成 0.0.0.0 的开关，
    // 迟早会有人在一台公网机器上打开它
    server.listen(deps.config().port, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      deps.log("info", `远程服务端已监听 127.0.0.1:${String(port)}`)
      done({
        port: () => port,
        disconnect: (deviceId) => {
          const sockets = live.get(deviceId)
          if (sockets === undefined) return 0
          const n = sockets.size
          for (const socket of sockets) socket.close(4003, "revoked")
          return n
        },
        close: async () => {
          for (const client of wss.clients) client.terminate()
          // **`close()` 只是不再收新连接，它会一直等已有连接自己结束。**
          // 而「已有连接」可能是一个正在往隧道里推 200 KB 前端产物、
          // 对端却卡在电梯里的 socket——那条永远不会自己结束。
          // 退出时 `shutdown` 是串行的：卡在这里就轮不到 `host.dispose()`，
          // 8 秒兜底一到直接 `app.exit(0)`，**整棵引擎进程树就漏了**。
          server.closeAllConnections()
          await new Promise<void>((resolve) => {
            server.close(() => {
              resolve()
            })
          })
        },
      })
    })
  })
}
