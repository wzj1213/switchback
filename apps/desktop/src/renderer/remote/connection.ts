import type { Command, ThreadId } from "@switchback/protocol"
import { createCalls, createTransport, packBytes, whoAmI, type ConnState, type Me, type Transport } from "@switchback/link"
import { initialStream, type Replay, type Sealed, type ServerFrame, type Stream } from "@switchback/wire"
import { createBodies, type Bodies } from "./bodies.js"
import { handleFrame, hub, type Answer, type History } from "./frames.js"
import { documentLocale } from "../i18n.js"
import { REMOTE_CONNECTION } from "./connection.messages.js"

export type { History } from "./frames.js"

/**
 * 远程模式里，桌面界面和宿主之间的那条线（`docs/远程模式方案.md`）。
 *
 * 它要把一条**会断的网络连接**接成渲染层熟悉的那几个口：`subscribe` / `onReplay` / `hello` /
 * `resync` 与同机 IPC 同形，渲染层的补洞逻辑（`useSwitchback`）一行不改。多出来的三件事都在这里：
 *
 * - **确认**：同机 IPC 不会丢，这条会，所以要按秒回 `ack`，宿主才放得掉保留缓冲。
 *   确认到哪由一份**影子游标**算——和渲染层用同一组纯函数（`@switchback/wire`）喂同样的帧，
 *   所以两边算出来的是同一个数，用不着渲染层回报。
 * - **重连**：重连时带着影子游标 `hello`，接得上只补差量；重新报一次正在看哪条。
 * - **调用**：宿主通道的请求与回答（`call` / `result`），没连上先排着。
 */

/** 攒多久回一次确认。理由同手机端（`apps/web/src/useRemote.ts`）。 */
const ACK_EVERY_MS = 1000

export interface Connection {
  /** 渲染层把监听都挂好了：可以开线、要全量了。**只开一次**，之后断了由传输层自己重连。 */
  start: () => void
  send: (command: Command) => boolean
  watch: (threadId: ThreadId | null) => void
  resync: (after: number, epoch: string) => Promise<Answer>
  call: (method: string, arg?: unknown) => Promise<unknown>
  onEvents: (listener: (sealed: readonly Sealed[]) => void) => () => void
  onReplay: (listener: (replay: Replay) => void) => () => void
  onHistory: (listener: (history: History) => void) => () => void
  onNotice: (listener: (text: string) => void) => () => void
  onState: (listener: (state: ConnState) => void) => () => void
  /** 现在的连接状态。晚挂上的监听（连接条）靠它拿到开头那一下。 */
  state: () => ConnState
  /** 让人看见一句话（和宿主发来的 `notice` 走同一个口）。 */
  say: (text: string) => void
  /** 哪些会话的正文还在路上、哪些被裁过。 */
  bodies: Bodies
  /** 宿主报的「我是谁」。连上之前是 undefined。 */
  me: () => Me | undefined
  close: () => void
}

interface Refs {
  transport: Transport | undefined
  /** 影子游标：确认到哪、重连时从哪续，都从它取。 */
  shadow: Stream
  watching: ThreadId | null
  ackTimer: ReturnType<typeof setTimeout> | undefined
  resync: { after: number; epoch: string; waiters: ((answer: Answer) => void)[] } | undefined
  me: Me | undefined
  state: ConnState
}

function freshRefs(): Refs {
  return {
    transport: undefined,
    shadow: initialStream,
    watching: null,
    ackTimer: undefined,
    resync: undefined,
    me: undefined,
    state: { kind: "connecting" },
  }
}

/** 开线。`hello` 带着影子游标：接得上只补差量，接不上宿主会发全量。 */
function openTransport(
  token: string,
  refs: Refs,
  on: { frame: (frame: ServerFrame) => void; state: (state: ConnState) => void },
): Transport {
  return createTransport({
    token,
    language: documentLocale,
    authorize: async () => {
      const seen = await whoAmI(token)
      if (seen.kind === "ok") refs.me = seen.me
      return seen.kind
    },
    onFrame: on.frame,
    onState: on.state,
    hello: () => {
      const { lastSeq, epoch } = refs.shadow
      return lastSeq === undefined || epoch === undefined ? { type: "hello" } : { type: "hello", after: lastSeq, epoch }
    },
  })
}

export function createConnection(token: string): Connection {
  const hubs = {
    events: hub<readonly Sealed[]>(),
    replay: hub<Replay>(),
    history: hub<History>(),
    notice: hub<string>(),
    state: hub<ConnState>(),
  }
  const bodies = createBodies()
  const refs = freshRefs()

  const sendFrame: Parameters<typeof createCalls>[0]["send"] = (frame) => refs.transport?.send(frame) ?? false
  const calls = createCalls({
    send: sendFrame,
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (h) => {
      clearTimeout(h as ReturnType<typeof setTimeout>)
    },
    language: documentLocale,
  })

  const scheduleAck = (): void => {
    if (refs.ackTimer !== undefined) return
    refs.ackTimer = setTimeout(() => {
      refs.ackTimer = undefined
      const seq = refs.shadow.lastSeq
      if (seq !== undefined) sendFrame({ type: "ack", seq })
    }, ACK_EVERY_MS)
  }

  /** 了结在等的补发。**返回有没有人在等**——没人等的 `reset` 要自己重新要一份全量。 */
  const answerResync = (answer: Answer): boolean => {
    const waiting = refs.resync?.waiters ?? []
    refs.resync = undefined
    for (const waiter of waiting) waiter(answer)
    return waiting.length > 0
  }

  const onFrame = (frame: ServerFrame): void => {
    handleFrame(frame, { refs, hubs, bodies, calls, scheduleAck, answerResync, rehello: () => sendFrame({ type: "hello" }) })
  }

  const onState = (state: ConnState): void => {
    if (state.kind === "open") {
      calls.opened()
      // 宿主那边这是一条新连接：它不知道我在看谁，也不知道我在等哪段补发
      if (refs.watching !== null) sendFrame({ type: "watch", threadId: refs.watching })
      if (refs.resync !== undefined) sendFrame({ type: "resync", after: refs.resync.after, epoch: refs.resync.epoch })
    } else if (state.kind === "unauthorized") {
      calls.close(REMOTE_CONNECTION[documentLocale()].revoked)
    } else {
      calls.dropped(state.kind === "retrying" ? state.reason : REMOTE_CONNECTION[documentLocale()].reconnecting)
    }
    refs.state = state
    hubs.state.emit(state)
  }

  return {
    start: () => {
      refs.transport ??= openTransport(token, refs, { frame: onFrame, state: onState })
    },
    send: (command) => sendFrame({ type: "command", command }),
    watch: (threadId) => {
      if (refs.watching === threadId) return
      refs.watching = threadId
      sendFrame({ type: "watch", threadId })
    },
    resync: (after, epoch) =>
      new Promise((resolve) => {
        refs.resync = { after, epoch, waiters: [...(refs.resync?.waiters ?? []), resolve] }
        sendFrame({ type: "resync", after, epoch })
      }),
    call: (method, arg) => calls.call(method, packBytes(arg)),
    onEvents: hubs.events.add,
    onReplay: hubs.replay.add,
    onHistory: hubs.history.add,
    onNotice: hubs.notice.add,
    onState: hubs.state.add,
    state: () => refs.state,
    say: hubs.notice.emit,
    bodies,
    me: () => refs.me,
    close: () => {
      refs.transport?.close()
      calls.close(REMOTE_CONNECTION[documentLocale()].closed)
    },
  }
}
