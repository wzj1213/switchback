import type { KimiFrame } from "./wire.js"

interface SocketLike {
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  send: (data: string) => void
  close: () => void
}

type SocketFactory = (url: string, protocols: readonly string[]) => SocketLike

export interface KimiCursor {
  seq: number
  epoch?: string
}

/**
 * 实时连接为什么断了。**只用来如实说给人听、写进日志**——恢复路径对几种一视同仁
 *（读快照、从新水位重新订阅）。以前一律报成同一句「实时连接已中断」，
 * 于是两千多条记录分不出是对面关的、要重同步的，还是 omni 自己处理某一帧时出了错。
 */
export type KimiDisconnect =
  | { kind: "closed"; code?: number; reason?: string }
  | { kind: "resync"; why: string }
  | { kind: "error"; message: string }

export interface KimiStreamDeps {
  wsUrl: string
  protocol: string
  sessionId: string
  cursor: KimiCursor
  onFrame: (frame: KimiFrame) => void
  onResync: () => Promise<KimiCursor>
  onDisconnect: (cause: KimiDisconnect) => void
  onRecovered: () => void
  onFatal: (error: Error) => void
  handshakeMs?: number
  socket?: SocketFactory
}

/**
 * 重连的间隔。前两次很快（多数断开一秒内就能接上），后面放慢、总共等十来秒：
 * 服务端正忙（卡住几秒）时，五连发两秒内打完就判死，反而把一条还活着的会话报成崩溃。
 */
const RETRY_MS = [0, 250, 1000, 2000, 4000, 8000] as const
const HANDSHAKE_MS = 15_000

class ResyncError extends Error {}

const GAP: KimiDisconnect = { kind: "resync", why: "omni 发现流里有缺口" }

function closedBy(event: unknown): KimiDisconnect {
  const { code, reason } = (event ?? {}) as { code?: unknown; reason?: unknown }
  return {
    kind: "closed",
    ...(typeof code === "number" ? { code } : {}),
    ...(typeof reason === "string" && reason !== "" ? { reason } : {}),
  }
}

function causeOf(error: unknown): KimiDisconnect {
  if (error instanceof ResyncError) return { kind: "resync", why: "服务端要求重新同步" }
  return { kind: "error", message: error instanceof Error ? error.message : String(error) }
}

function defaultSocket(url: string, protocols: readonly string[]): SocketLike {
  const Ctor = (
    globalThis as unknown as {
      WebSocket?: new (target: string, protocols: readonly string[]) => SocketLike
    }
  ).WebSocket
  if (Ctor === undefined)
    throw new Error("当前 Node 运行时没有 WebSocket，请使用 Node 22 或更新版本")
  return new Ctor(url, protocols)
}

function frameOf(event: unknown): KimiFrame {
  const data = (event as { data?: unknown }).data
  if (typeof data === "string") return JSON.parse(data) as KimiFrame
  if (data instanceof ArrayBuffer)
    return JSON.parse(Buffer.from(data).toString("utf8")) as KimiFrame
  if (ArrayBuffer.isView(data))
    return JSON.parse(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"),
    ) as KimiFrame
  throw new Error("Kimi WebSocket 发来了无法识别的数据帧")
}

function strings(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : []
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class KimiStream {
  private socket: SocketLike | undefined
  private cursor: KimiCursor
  private disposed = false
  private recovering: Promise<void> | undefined
  private forceSnapshot = false

  constructor(private readonly deps: KimiStreamDeps) {
    this.cursor = deps.cursor
  }

  private subscription(socket: SocketLike): void {
    const cursor = this.cursor.seq <= 0 ? undefined : { [this.deps.sessionId]: this.cursor }
    socket.send(
      JSON.stringify({
        type: "subscribe",
        id: "omni-subscribe",
        payload: {
          session_ids: [this.deps.sessionId],
          ...(cursor === undefined ? {} : { cursors: cursor }),
        },
      }),
    )
  }

  private pong(frame: KimiFrame): boolean {
    if (frame.type !== "ping") return false
    const nonce = (frame.payload as { nonce?: unknown } | undefined)?.nonce
    if (typeof nonce === "string")
      this.socket?.send(JSON.stringify({ type: "pong", payload: { nonce } }))
    return true
  }

  private advance(frame: KimiFrame): boolean {
    if (frame.volatile === true || frame.seq === undefined) return true
    if (frame.seq <= this.cursor.seq) return false
    this.cursor = { seq: frame.seq, ...(frame.epoch === undefined ? {} : { epoch: frame.epoch }) }
    return true
  }

  private takeEvent(frame: KimiFrame): void {
    if (this.pong(frame)) return
    if (frame.type === "resync_required") throw new ResyncError("Kimi WebSocket 要求重新同步")
    if (frame.session_id !== this.deps.sessionId || frame.payload === undefined) return
    if (!this.advance(frame)) return
    this.deps.onFrame(frame)
  }

  private ack(frame: KimiFrame): void {
    const payload = (frame.payload ?? {}) as Record<string, unknown>
    if (frame.code !== 0 || !strings(payload["accepted"]).includes(this.deps.sessionId)) {
      throw new Error(frame.msg || "Kimi WebSocket 拒绝订阅这个会话")
    }
    if (strings(payload["resync_required"]).includes(this.deps.sessionId)) {
      throw new ResyncError("Kimi WebSocket 要求重新同步")
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = (this.deps.socket ?? defaultSocket)(this.deps.wsUrl, [this.deps.protocol])
      this.socket = socket
      const state: { settled: boolean; subscribed: boolean; ready: boolean; cause?: KimiDisconnect } = {
        settled: false, subscribed: false, ready: false,
      }
      const settle = (error?: Error): void => {
        if (state.settled) return
        state.settled = true
        clearTimeout(timer)
        if (error === undefined) resolve()
        else reject(error)
      }
      const timer = setTimeout(() => {
        settle(new Error("Kimi WebSocket 在订阅握手阶段没有响应"))
        socket.close()
      }, this.deps.handshakeMs ?? HANDSHAKE_MS)
      socket.addEventListener("message", (event) => {
        try {
          const frame = frameOf(event)
          if (frame.type === "server_hello" && !state.subscribed) {
            state.subscribed = true
            this.subscription(socket)
            return
          }
          if (frame.type === "ack" && frame.id === "omni-subscribe") {
            this.ack(frame)
            state.ready = true
            settle()
            return
          }
          this.takeEvent(frame)
        } catch (error) {
          state.cause = causeOf(error)
          settle(error instanceof Error ? error : new Error(String(error)))
          socket.close()
        }
      })
      socket.addEventListener("error", () => settle(new Error("Kimi WebSocket 连接失败")))
      socket.addEventListener("close", (event) => {
        if (this.socket === socket) this.socket = undefined
        if (!state.settled) {
          const error = this.forceSnapshot
            ? new ResyncError("Kimi 流式 offset 要求重新同步")
            : new Error("Kimi WebSocket 在订阅完成前断开")
          settle(error)
        } else if (state.ready && !this.disposed) {
          void this.recover(state.cause ?? (this.forceSnapshot ? GAP : closedBy(event)))
        }
      })
    })
  }

  private async connectWithResync(): Promise<void> {
    try {
      await this.connectOnce()
    } catch (error) {
      if (!(error instanceof ResyncError)) throw error
      this.cursor = await this.deps.onResync()
      this.forceSnapshot = false
      await this.connectOnce()
    }
  }

  async connect(): Promise<void> {
    await this.connectWithResync()
  }

  private recover(cause: KimiDisconnect): Promise<void> {
    if (this.recovering !== undefined) return this.recovering
    this.deps.onDisconnect(cause)
    this.recovering = this.tryRecover().finally(() => {
      this.recovering = undefined
    })
    return this.recovering
  }

  private async tryRecover(): Promise<void> {
    let last = new Error("Kimi WebSocket 重连失败")
    for (const delay of RETRY_MS) {
      if (this.disposed) return
      await wait(delay)
      if (this.disposed) return
      try {
        this.cursor = await this.deps.onResync()
        this.forceSnapshot = false
        await this.connectWithResync()
        this.adoptCursor(await this.deps.onResync())
        if (this.forceSnapshot || this.socket === undefined) continue
        this.deps.onRecovered()
        return
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error))
        this.dropSocket()
      }
    }
    if (!this.disposed) this.deps.onFatal(last)
  }

  private adoptCursor(next: KimiCursor): void {
    const changedEpoch =
      next.epoch !== undefined &&
      this.cursor.epoch !== undefined &&
      next.epoch !== this.cursor.epoch
    if (changedEpoch || next.seq > this.cursor.seq) this.cursor = next
  }

  private dropSocket(): void {
    const socket = this.socket
    this.socket = undefined
    socket?.close()
  }

  /** offset 证明流中间有缺口时，先用原子快照重建，再从它的水位重新订阅。 */
  requestResync(): void {
    if (this.disposed) return
    this.forceSnapshot = true
    this.dropSocket()
  }

  dispose(): Promise<void> {
    this.disposed = true
    this.socket?.close()
    this.socket = undefined
    return Promise.resolve()
  }
}
