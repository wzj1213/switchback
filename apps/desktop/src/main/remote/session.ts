import type { Command, Event, ThreadId, Trust } from "@omni/protocol"
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
  /**
   * 一条会话的历史。**分级 replay 的另一半**：全量只带最近几条的正文，
   * 客户端打开别的会话时用这个把它补上。
   */
  history: (threadId: ThreadId) => Promise<readonly Event[]>
  /** 这条连接的档位上限，现读现算（设置可能中途改）。 */
  ceiling: () => Trust
  /**
   * 某条会话现在是哪一档。**上限要靠它才管得住已有的会话**——
   * 光钳「新建」和「切档」的话，桌面上一条完全档会话对远程是完全敞开的。
   */
  trustOf: (threadId: string) => Trust | undefined
  log: (level: "info" | "warn" | "error", message: string) => void
}

export interface RemoteSession {
  sink: Sink
  /** 客户端发来一帧。**任何解析失败都不许抛**——一条坏帧不该掐掉连接以外的任何东西。 */
  receive: (text: string) => void
  /**
   * 连接没了。**必须调**，否则 `sink.alive()` 永远返回 true。
   *
   * 那一句在 `rebuild` 里是唯一的「对方还在吗」判据，而远程客户端正是唯一一类
   * 会在 rebuild 跑到一半真的消失的客户端——读几十 MB journal 要几百毫秒到数秒，
   * 隧道在那期间断掉太常见了。判不出来的话，整份全量照样在主线程上
   * 同步序列化 + 切片，喂给一个已经关掉的 socket：**约一秒的界面冻结，
   * 还顺带卡住引擎 stdio 的抽取**，而弱网重连风暴时每断一次就再来一遍。
   */
  stop: () => void
}

interface State {
  frameId: number
  alive: boolean
  watching: ThreadId | undefined
  /**
   * 已经把正文发过的会话。
   *
   * **要记**：客户端在会话之间来回切时，第二次打开不该再传一遍几百 KB。
   * 记在连接上而不是设备上——重连之后客户端走的是全量，那一份自带最近几条的正文。
   */
  loaded: Set<ThreadId>
}

interface Ctx {
  deps: SessionDeps
  state: State
  write: (frame: ServerFrame) => void
  sink: Sink
}

function writer(deps: SessionDeps, state: State): (frame: ServerFrame) => void {
  const write = (frame: ServerFrame): void => {
    if (!state.alive) return
    if (deps.buffered() > MAX_BUFFERED) {
      // 跟不上就断，别在内存里替它攒。它重连时走全量，那条路本来就设计好了
      state.alive = false
      deps.log("warn", `${deps.id} 积压超过 ${String(MAX_BUFFERED)} 字节，断开让它重连`)
      deps.close(1013, "backpressure")
      return
    }
    state.frameId += 1
    const encoded = encodeFrame(frame, state.frameId)
    if (encoded.kind === "too-big") {
      // **说出来，别发一串对端注定拒收的片。** 这一条现在只可能发生在全量重建上
      //（它把所有会话的完整历史拼成一份），而那正是掉进去之后最难查的场景：
      // 每次重连都从第一片被拒，两边都只看到「又断了」
      deps.log(
        "error",
        `${deps.id} 的 ${frame.type} 帧有 ${String(encoded.chars)} 个码元，超过 ${String(encoded.limit)}，发不出去`,
      )
      if (frame.type !== "reset") {
        write({ type: "reset", reason: "这台机器上的历史太长，手机端暂时装不下——先在桌面上删掉几条旧会话" })
      }
      return
    }
    for (const text of encoded.parts) deps.send(text)
  }
  return write
}

/**
 * 「我准备好了」。带 `after` + `epoch` 就先试着只补差量——
 * **这正是隧道和地铁的意义所在**：补得上就别把整段历史重发一遍。补不上再走全量。
 *
 * 两个字段必须成对：只报序号不报代号的话，宿主分不出这个游标是不是
 * 上一次运行留下的（见 `@omni/wire` 的 `Replay.epoch`），于是干脆当没带。
 */
function hello(ctx: Ctx, after: number | undefined, epoch: string | undefined): void {
  ctx.deps.ledger.join(ctx.deps.id)
  const resumable = after !== undefined && epoch !== undefined
  const missed = resumable ? ctx.deps.ledger.since(after, epoch) : undefined
  if (missed !== undefined) {
    ctx.deps.log("info", `${ctx.deps.id} 从 ${String(after)} 续上，补 ${String(missed.length)} 条`)
    if (missed.length > 0) ctx.write({ type: "events", sealed: missed })
    return
  }
  if (resumable) ctx.deps.log("info", `${ctx.deps.id} 停在 ${String(after)}，续不上，转全量重建`)
  void ctx.deps.replay(ctx.sink).catch((error: unknown) => {
    ctx.deps.log("error", `${ctx.deps.id} 全量重建失败：${String(error)}`)
    ctx.write({ type: "reset", reason: "全量重建失败，请重连" })
  })
}

/**
 * 「我这儿从 `after` 之后断了一截。」
 *
 * 和 `hello` 分开的理由在 `ClientFrame` 上：这条**不重新 join 账本**。
 * 补不了就明说 `reset`——绝不发一个不完整的片段，那会让界面安静地显示错误内容。
 */
function resync(ctx: Ctx, after: number, epoch: string): void {
  const missed = ctx.deps.ledger.since(after, epoch)
  if (missed === undefined) {
    ctx.deps.log("warn", `${ctx.deps.id} 停在 ${String(after)}，补不了，让它重新握手`)
    ctx.write({ type: "reset", reason: "缺口太老，补不回来了" })
    return
  }
  ctx.write({ type: "catchup", sealed: missed })
}

/**
 * 一条命令。
 *
 * **凡是没照着做的，都要说一声。** 认不出、被拒、被钳——三种都往回发一条
 * `notice`。少了这一步，用户在手机上点了「允许」而工具被拒，
 * 界面上不会有任何东西说这里出过事。
 */
function command(ctx: Ctx, raw: unknown): void {
  if (!isCommand(raw)) {
    ctx.deps.log("warn", `${ctx.deps.id} 发来一条认不出的命令，已丢弃`)
    ctx.write({ type: "notice", text: "这条命令的形状 omni 认不出来，没有执行" })
    return
  }
  const verdict = clamp(raw, ctx.deps.ceiling(), ctx.deps.trustOf)
  if (verdict.command === undefined) {
    ctx.deps.log("warn", `${ctx.deps.id} 被拒：${verdict.note}`)
    ctx.write({ type: "notice", text: verdict.note })
    return
  }
  if (verdict.note !== undefined) {
    ctx.deps.log("info", `${ctx.deps.id} ${verdict.note}`)
    ctx.write({ type: "notice", text: verdict.note })
  }
  ctx.deps.dispatch(verdict.command)
}

/** 线上来的字段类型不作数，逐个收窄。 */
const numberOr = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)
const stringOr = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/** `resync` 的两个字段必须成对，缺一个就当没发过。 */
function cursor(ctx: Ctx, after: unknown, epoch: unknown): void {
  const at = numberOr(after)
  const run = stringOr(epoch)
  if (at !== undefined && run !== undefined) resync(ctx, at, run)
}

/**
 * 客户端打开了一条会话。它的正文在全量里吗？不在就补一份。
 *
 * **不等**：补正文要读磁盘，而 `watch` 是一条即发即忘的帧。
 * 读失败就算了——用户看到的是一条空会话，退出去再进来会再试一次。
 */
function load(ctx: Ctx, threadId: ThreadId | undefined): void {
  if (threadId === undefined || ctx.state.loaded.has(threadId)) return
  ctx.state.loaded.add(threadId)
  void ctx.deps
    .history(threadId)
    .then((events) => {
      if (events.length > 0) ctx.write({ type: "thread", threadId, events })
    })
    .catch((error: unknown) => {
      // 补不上就把标记撤掉，下次再打开时还能再试一次
      ctx.state.loaded.delete(threadId)
      ctx.deps.log("warn", `${ctx.deps.id} 补 ${threadId} 的正文失败：${String(error)}`)
    })
}

function handle(ctx: Ctx, frame: ClientFrame): void {
  switch (frame.type) {
    case "hello":
      hello(ctx, numberOr(frame.after), stringOr(frame.epoch))
      return
    case "resync":
      cursor(ctx, frame.after, frame.epoch)
      return
    case "command":
      command(ctx, frame.command)
      return
    case "ack":
      {
        const seq = numberOr(frame.seq)
        if (seq !== undefined) ctx.deps.ledger.ack(ctx.deps.id, seq)
      }
      return
    case "watch":
      ctx.state.watching = stringOr(frame.threadId)
      load(ctx, ctx.state.watching)
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
  const state: State = { frameId: 0, alive: true, watching: undefined, loaded: new Set() }
  const write = writer(deps, state)

  const sink: Sink = {
    id: deps.id,
    send: (message: SinkMessage) => {
      if (message.channel === "omni:events") {
        write({ type: "events", sealed: message.sealed })
        return
      }
      // 全量里已经带了正文的那些，`watch` 时不用再读一次磁盘。
      // **缺省 = 全都带**，那是同机 IPC 那条路的语义
      for (const id of message.replay.bodies ?? []) state.loaded.add(id)
      write({ type: "replay", replay: message.replay })
    },
    alive: () => state.alive,
    watching: () => state.watching,
  }

  const ctx: Ctx = { deps, state, write, sink }

  return {
    sink,
    stop: () => {
      state.alive = false
    },
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
