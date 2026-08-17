import type { Command, ThreadId, Trust } from "@omni/protocol"
import { encodeFrame, type ClientFrame, type Ledger, type ServerFrame } from "@omni/wire"
import type { Sink, SinkMessage } from "../sink.js"
import { clamp, isCommand } from "./policy.js"

/**
 * 一条连上来的远程客户端。
 *
 * 它做的事和一扇窗口完全一样（收事件、发命令），差别只在管子：
 * 窗口那条是同进程 IPC，这条要过网络，所以多三件事——**确认、补发、分片**。
 * 那三件都在 `@omni/wire` 里，这里只负责把它们接到一条真的连接上。
 */

/** 写出去还没被对端收走的字节超过这个数，就认定它跟不上，断开让它重来。 */
const MAX_BUFFERED = 8 * 1024 * 1024

export interface SessionDeps {
  /** 稳定身份。账本按它记确认位，日志按它认人。 */
  id: string
  send: (text: string) => void
  close: (code: number, reason: string) => void
  /** 还没写出去的字节数。背压判据。 */
  buffered: () => number
  ledger: Ledger
  dispatch: (command: Command) => void
  /** 给这条连接发一份全量。**只发给它一个**——广播出去别的客户端会把历史再应用一遍。 */
  replay: (sink: Sink) => Promise<void>
  /** 这条连接的档位上限，现读现算（设置可能中途改）。 */
  ceiling: () => Trust
  log: (level: "info" | "warn" | "error", message: string) => void
}

export interface RemoteSession {
  sink: Sink
  /** 客户端发来一帧。**任何解析失败都不许抛**——一条坏帧不该掐掉连接以外的任何东西。 */
  receive: (text: string) => void
}

interface State {
  frameId: number
  alive: boolean
  watching: ThreadId | undefined
}

interface Ctx {
  deps: SessionDeps
  state: State
  write: (frame: ServerFrame) => void
  sink: Sink
}

function writer(deps: SessionDeps, state: State): (frame: ServerFrame) => void {
  return (frame) => {
    if (!state.alive) return
    if (deps.buffered() > MAX_BUFFERED) {
      // 跟不上就断，别在内存里替它攒。它重连时走全量，那条路本来就设计好了
      state.alive = false
      deps.log("warn", `${deps.id} 积压超过 ${String(MAX_BUFFERED)} 字节，断开让它重连`)
      deps.close(1013, "backpressure")
      return
    }
    state.frameId += 1
    for (const text of encodeFrame(frame, state.frameId)) deps.send(text)
  }
}

/**
 * 「我准备好了」。带 `after` 就先试着只补差量——**这正是隧道和地铁的意义所在**：
 * 补得上就别把整段历史重发一遍。补不上再走全量。
 */
function hello(ctx: Ctx, after: number | undefined): void {
  ctx.deps.ledger.join(ctx.deps.id)
  const missed = after === undefined ? undefined : ctx.deps.ledger.since(after)
  if (after !== undefined && missed !== undefined) {
    ctx.deps.log("info", `${ctx.deps.id} 从 ${String(after)} 续上，补 ${String(missed.length)} 条`)
    if (missed.length > 0) ctx.write({ type: "events", sealed: missed })
    return
  }
  if (after !== undefined) {
    ctx.deps.log("info", `${ctx.deps.id} 停在 ${String(after)}，缓冲覆盖不到，转全量重建`)
  }
  void ctx.deps.replay(ctx.sink).catch((error: unknown) => {
    ctx.deps.log("error", `${ctx.deps.id} 全量重建失败：${String(error)}`)
    ctx.write({ type: "reset", reason: "全量重建失败，请重连" })
  })
}

function command(ctx: Ctx, raw: unknown): void {
  if (!isCommand(raw)) {
    ctx.deps.log("warn", `${ctx.deps.id} 发来一条认不出的命令，已丢弃`)
    return
  }
  const { command: clamped, note } = clamp(raw, ctx.deps.ceiling())
  if (note !== undefined) ctx.deps.log("info", `${ctx.deps.id} ${note}`)
  ctx.deps.dispatch(clamped)
}

function handle(ctx: Ctx, frame: ClientFrame): void {
  switch (frame.type) {
    case "hello":
      hello(ctx, typeof frame.after === "number" ? frame.after : undefined)
      return
    case "command":
      command(ctx, frame.command)
      return
    case "ack":
      if (typeof frame.seq === "number") ctx.deps.ledger.ack(ctx.deps.id, frame.seq)
      return
    case "watch":
      ctx.state.watching = typeof frame.threadId === "string" ? frame.threadId : undefined
      return
    case "ping":
      ctx.write({ type: "pong" })
      return
    default:
      // 认不出的帧一律忽略。**不断连接**——对端可能只是比我们新
      return
  }
}

export function createSession(deps: SessionDeps): RemoteSession {
  const state: State = { frameId: 0, alive: true, watching: undefined }
  const write = writer(deps, state)

  const sink: Sink = {
    id: deps.id,
    send: (message: SinkMessage) => {
      write(
        message.channel === "omni:events"
          ? { type: "events", sealed: message.sealed }
          : { type: "replay", replay: message.replay },
      )
    },
    alive: () => state.alive,
    watching: () => state.watching,
  }

  const ctx: Ctx = { deps, state, write, sink }

  return {
    sink,
    receive: (text) => {
      let frame: ClientFrame
      try {
        frame = JSON.parse(text) as ClientFrame
      } catch {
        deps.log("warn", `${deps.id} 发来的不是合法 JSON，已丢弃`)
        return
      }
      if (typeof frame !== "object" || frame === null) return
      handle(ctx, frame)
    },
  }
}
