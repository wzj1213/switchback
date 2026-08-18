import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocketServer, type WebSocket } from "ws"
import type { Command, Trust } from "@omni/protocol"
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
  /** 浏览器端构建产物所在目录。目录不在就只有 API，没有页面——**不假装有**。 */
  webRoot: string
  tokens: TokenStore
  ledger: Ledger
  sinks: Sinks
  dispatch: (command: Command) => void
  replay: (sink: Sink) => Promise<void>
  /** 某条会话现在是哪一档。档位上限靠它才管得住已经开着的会话。 */
  trustOf: (threadId: string) => Trust | undefined
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

function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function route(deps: RemoteDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const verdict = checkRequest(headersOf(req.headers), deps.config().trustedHosts)
    if (!verdict.ok) {
      deps.log("warn", `拦下一个请求：${verdict.reason}`)
      json(res, 403, { error: "forbidden" })
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
    log: deps.log,
  })
  const detach = deps.sinks.add(session.sink)
  const bucket = live.get(deviceId) ?? new Set<WebSocket>()
  bucket.add(ws)
  live.set(deviceId, bucket)
  ws.on("message", (data) => {
    session.receive(String(data))
  })
  const bye = (): void => {
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
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => WS_PROTOCOL })
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
