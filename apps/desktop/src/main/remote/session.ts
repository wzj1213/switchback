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
   *
   * **每来一份新的全量就清空**：新的那份可能带着不一样的 `bodies`
   *（会话的新旧次序变了、预算内装得下的那几条换了人），
   * 旧的勾会把「这条要补」永久挡掉——表现是那条会话在这条连接上一直空白。
   */
  loaded: Set<ThreadId>
  /**
   * 全量发出去了没有。**补正文必须排在它后面。**
   *
   * 客户端重连时先发 `hello` 再发 `watch`，但两条在宿主这侧都要读磁盘，
   * 谁先读完谁先出门——`thread` 帧完全可能跑在全量前面。而客户端收到全量时
   * 是**从零重建**的，先到的那份正文当场被抹掉；宿主这边却已经把
   * `loaded` 打了勾，于是那条会话在这条连接的余生里一直是空的。
   *
   * 所以这里挂一个闸：全量真正写出去之前，补正文一律等着。
   */
  baseline: { done: boolean; waiting: (() => void)[] }
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
  if (missed !== undefined && !tooMuch(missed)) {
    ctx.deps.log("info", `${ctx.deps.id} 从 ${String(after)} 续上，补 ${String(missed.length)} 条`)
    if (missed.length > 0) ctx.write({ type: "events", sealed: missed })
    // **续上的这条路没有全量**，客户端手上那份基线是它自己保着的。
    // 闸得在这儿开，否则补正文会永远等一份不会来的全量
    release(ctx.state)
    return
  }
  if (resumable) ctx.deps.log("info", `${ctx.deps.id} 停在 ${String(after)}，续不上或补不动，转全量重建`)
  void ctx.deps.replay(ctx.sink).catch((error: unknown) => {
    ctx.deps.log("error", `${ctx.deps.id} 全量重建失败：${String(error)}`)
    ctx.write({ type: "reset", reason: "全量重建失败，请重连" })
    // 全量没出去，但也别把补正文永久卡在闸后面——客户端接到 reset 会重连，
    // 而在那之前挂着的那些 promise 该有个了结
    release(ctx.state)
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
  // **补得动才补。** 见 `TOO_MUCH_TO_CATCH_UP`：补不动时反复要同一帧
  // 是个不会自己好的死循环，而走全量那条路已经封了顶
  if (tooMuch(missed)) {
    ctx.deps.log("warn", `${ctx.deps.id} 停在 ${String(after)}，这一段太大补不动，让它走全量`)
    ctx.write({ type: "reset", reason: "断开太久了，重新拉一份" })
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
 * 一段补发大到该放弃了吗。
 *
 * ## 为什么补差量也要有闸
 *
 * 全量那条路已经按大小收窄了（`scope.ts`），而**补差量这条路原样留着**：
 * 账本最多留 5000 条事件，一条 1.5 KB 的话就是 7.5 MB 一帧——正好在
 * `encodeFrame` 那个 16M 的「太大」线以下，所以一个警告都不会有。
 *
 * 更糟的是它**不会自己好**：客户端拿同一个游标反复要同一帧，
 * 收不完就再要一次，两边都只看到「又断了」。这和真机上栽的那个死循环
 * 是同一族——那个是全量太大，这个是补发太大。
 *
 * 补不动就当补不上：回 `reset`，让它走全量（那条已经封了顶）。
 * **宁可让它重来一次，也不要卡在一个永远发不完的帧上。**
 */
const TOO_MUCH_TO_CATCH_UP = 192 * 1024

function tooMuch(sealed: readonly { event: unknown }[]): boolean {
  let chars = 0
  for (const one of sealed) {
    chars += JSON.stringify(one.event).length
    if (chars > TOO_MUCH_TO_CATCH_UP) return true
  }
  return false
}

/** 全量出门了，放行等在闸后面的那些补正文。 */
function release(state: State): void {
  state.baseline.done = true
  const waiting = state.baseline.waiting.splice(0)
  for (const resume of waiting) resume()
}

/** 等基线。已经到位就立刻继续，否则排队。 */
function awaitBaseline(state: State): Promise<void> {
  if (state.baseline.done) return Promise.resolve()
  return new Promise((resume) => state.baseline.waiting.push(resume))
}

/**
 * 客户端打开了一条会话。它的正文在全量里吗？不在就补一份。
 *
 * **不等 `watch` 那一帧**：补正文要读磁盘，而 `watch` 是即发即忘的。
 * 但**要等全量**（见 `State.baseline`）——先到的 `thread` 帧会被随后的全量抹掉。
 *
 * 读失败就把标记撤掉，退出去再进来还能再试一次。
 */
function load(ctx: Ctx, threadId: ThreadId | undefined): void {
  if (threadId === undefined || ctx.state.loaded.has(threadId)) return
  ctx.state.loaded.add(threadId)
  void awaitBaseline(ctx.state)
    .then(() => ctx.deps.history(threadId))
    .then((events) => {
      // 等的这段时间里连接可能已经没了；也可能已经换了一份全量、
      // 而那一份正好带上了这条的正文（`loaded` 被清空后重新预置）
      if (!ctx.state.alive || events.length === 0) return
      ctx.write({ type: "thread", threadId, events })
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
  const state: State = {
    frameId: 0,
    alive: true,
    watching: undefined,
    loaded: new Set(),
    baseline: { done: false, waiting: [] },
  }
  const write = writer(deps, state)

  const sink: Sink = {
    id: deps.id,
    send: (message: SinkMessage) => {
      if (message.channel === "omni:events") {
        write({ type: "events", sealed: message.sealed })
        return
      }
      // **先清空再按这一份预置**：换一份全量就是换一套「哪些带了正文」
      state.loaded.clear()
      // 全量里已经带了正文的那些，`watch` 时不用再读一次磁盘。
      // **缺省 = 全都带**，那是同机 IPC 那条路的语义
      for (const id of message.replay.bodies ?? []) state.loaded.add(id)
      write({ type: "replay", replay: message.replay })
      release(state)
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
