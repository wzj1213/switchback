import { useCallback, useEffect, useRef, useState } from "react"
import type { Command, ThreadId } from "@omni/protocol"
import { clearNotices, initial, reduceAll, type ViewState } from "@omni/store"
import {
  initialStream,
  received,
  replayed,
  reset as resetStream,
  type ClientFrame,
  type ServerFrame,
  type Step,
  type Stream,
} from "@omni/wire"
import { createTransport, type ConnState, type Transport } from "./transport.js"
import { tokenOf, whoAmI, type Me } from "./auth.js"

/**
 * 事件流 → 视图状态。**和桌面端跑的是同一个归约器**（`@omni/store`），
 * 所以两端不会漂移：手机上看到的「正在跑」和桌面上那条是同一次判断。
 *
 * 补洞那套（`@omni/wire` 的 `received` / `replayed`）也是同一份。
 * 唯一多出来的是**确认**：桌面那条 IPC 不会丢，这条会。
 */

/** 攒多久发一次 ack。太密是白发（一次 `pnpm build` 能刷上千条），太疏则保留缓冲白留。 */
const ACK_EVERY_MS = 1000

export interface Remote {
  state: ViewState
  conn: ConnState
  me: Me | undefined
  send: (command: Command) => void
  /** 告诉宿主「我正在看这条」。宿主据此决定发不发正文、要不要为它响。 */
  watch: (threadId: ThreadId | null) => void
  /** 用户点了「重试」。 */
  retry: () => void
}

interface Refs {
  stream: Stream
  transport: Transport | undefined
  ackTimer: ReturnType<typeof setTimeout> | undefined
  watching: ThreadId | null
}

export function useRemote(token: string): Remote {
  const [state, setState] = useState<ViewState>(initial)
  const [conn, setConn] = useState<ConnState>({ kind: "connecting" })
  const [me, setMe] = useState<Me | undefined>(undefined)
  const refs = useRef<Refs>({ stream: initialStream, transport: undefined, ackTimer: undefined, watching: null })

  /** 应用一步，并安排一次确认。 */
  const advance = useCallback((step: Step): void => {
    refs.current.stream = step.stream
    if (step.apply.length > 0) setState((prev) => reduceAll(prev, step.apply))
    scheduleAck(refs)
  }, [])

  const onFrame = useCallback(
    (frame: ServerFrame): void => {
      if (frame.type === "events") {
        advance(received(refs.current.stream, frame.sealed))
        return
      }
      if (frame.type === "replay") {
        // 全量是「世界现在长什么样」，不是增量——先把归约器清回初始态，
        // 否则重连之后新旧两份历史会叠在一起
        setState(initial)
        advance(replayed({ ...refs.current.stream, lastSeq: undefined }, frame.replay))
        // 横幅说的是「刚刚发生了一件事」，那是时刻不是状态；重放会把历史上
        // 每一次引擎崩溃重新弹一遍
        setState(clearNotices)
        return
      }
      if (frame.type === "reset") {
        refs.current.stream = resetStream()
        refs.current.transport?.send({ type: "hello" })
      }
    },
    [advance],
  )

  useEffect(() => {
    if (token === "") return undefined
    const transport = createTransport({
      token,
      authorize: async () => {
        const seen = await whoAmI(token)
        setMe(seen)
        return seen !== undefined
      },
      onFrame,
      onState: setConn,
      hello: () => {
        const after = refs.current.stream.lastSeq
        // 重连时把观察目标一并重报：宿主那边的会话是新的，它不知道我在看谁
        queueMicrotask(() => {
          refs.current.transport?.send({ type: "watch", threadId: refs.current.watching })
        })
        return after === undefined ? { type: "hello" } : { type: "hello", after }
      },
    })
    refs.current.transport = transport
    // 页面从后台回到前台时立刻探一次。手机上这是最常见的「看起来连着、其实早断了」
    const wake = (): void => {
      if (document.visibilityState === "visible") transport.poke()
    }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("online", wake)
    return () => {
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("online", wake)
      transport.close()
      refs.current.transport = undefined
    }
  }, [token, onFrame])

  const send = useCallback((command: Command): void => {
    refs.current.transport?.send({ type: "command", command })
  }, [])

  const watch = useCallback((threadId: ThreadId | null): void => {
    refs.current.watching = threadId
    refs.current.transport?.send({ type: "watch", threadId })
  }, [])

  const retry = useCallback((): void => {
    refs.current.transport?.poke()
  }, [])

  return { state, conn, me, send, watch, retry }
}

/**
 * 攒一下再确认。
 *
 * **确认不能每条都发**：一次构建能刷出上千条事件，逐条回 ack 等于把上行也刷满。
 * 也不能不发——宿主的保留缓冲靠它才放得掉，而放不掉就只能等条数上限把它顶出去，
 * 那时正好回到「掉队就得走全量」的老问题。
 */
function scheduleAck(refs: { current: Refs }): void {
  if (refs.current.ackTimer !== undefined) return
  refs.current.ackTimer = setTimeout(() => {
    refs.current.ackTimer = undefined
    const seq = refs.current.stream.lastSeq
    if (seq === undefined) return
    refs.current.transport?.send({ type: "ack", seq } satisfies ClientFrame)
  }, ACK_EVERY_MS)
}

/** 首屏用：本机存着的令牌。 */
export { tokenOf }
