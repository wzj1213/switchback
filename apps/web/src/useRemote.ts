import { useCallback, useEffect, useRef, useState } from "react"
import type { Command, ThreadId } from "@omni/protocol"
import { clearNotices, initial, reduceAll, reduceHistory, type ViewState } from "@omni/store"
import {
  initialStream,
  received,
  replayed,
  reset as resetStream,
  resynced,
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
 * 补洞那套（`@omni/wire` 的 `received` / `replayed` / `resynced`）也是同一份。
 * 这一端多出来的只有两件事：**确认**（桌面那条 IPC 不会丢，这条会）
 * 和**去补**（发现序号跳了要主动要那一段）。
 */

/** 攒多久发一次 ack。太密是白发（一次 `pnpm build` 能刷上千条），太疏则保留缓冲白留。 */
const ACK_EVERY_MS = 1000

export interface Remote {
  state: ViewState
  conn: ConnState
  me: Me | undefined
  /**
   * 发一条命令。**返回有没有真的发出去。**
   *
   * 断线时返回 false，调用方必须让用户看见——用户点了「允许」而什么都没发生，
   * 是这一端最坏的失败方式。
   */
  send: (command: Command) => boolean
  /** 告诉宿主「我正在看这条」。宿主据此决定发不发正文、要不要为它响。 */
  watch: (threadId: ThreadId | null) => void
  /** 用户点了「重试」。 */
  retry: () => void
  /** 宿主捎回来的话（命令被拒、被钳…）。最新一条，用户看完可以关掉。 */
  notice: string | undefined
  dismissNotice: () => void
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
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const refs = useRef<Refs>({ stream: initialStream, transport: undefined, ackTimer: undefined, watching: null })

  /**
   * 应用一步：落状态、安排一次确认、**缺了就去补**。
   *
   * 最后那一句是必须的：`drain` 走不动时会把 `catching` 置上并给出 `resyncFrom`，
   * 而在此之后来的增量一律只攒不应用。没人去补的话，界面就从那一刻起
   * **永久静默冻结**——事件照收、什么都不显示、一行错误都没有。
   */
  const advance = useCallback((step: Step): void => {
    refs.current.stream = step.stream
    if (step.apply.length > 0) setState((prev) => reduceAll(prev, step.apply))
    scheduleAck(refs)
    if (step.resyncFrom === undefined) return
    const epoch = refs.current.stream.epoch
    if (epoch === undefined) return
    refs.current.transport?.send({ type: "resync", after: step.resyncFrom, epoch })
  }, [])

  const onFrame = useCallback(
    (frame: ServerFrame): void => {
      if (frame.type === "events") {
        advance(received(refs.current.stream, frame.sealed))
        return
      }
      if (frame.type === "catchup") {
        // **补发要走 `resynced` 而不是 `received`**：后者在 catching 状态下
        // 只攒不应用，于是补回来的那一段也被攒起来，catching 永远解不开
        advance(resynced(refs.current.stream, frame.sealed))
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
      if (frame.type === "thread") {
        // **只补自己没有的那些 item。**
        //
        // 这是一份**历史快照**，不是「刚刚发生的一件事」。而在它读磁盘、
        // 过隧道的这段时间里，同一条会话的 delta 照样在走常态那条路。
        // 无条件应用的话，一条正在流的消息会被这份旧快照盖回去——
        // 用户看到的是正文突然倒退几百个字，然后再也不动
        //（那条 item 的后续 delta 仍然落在同一个 id 上，但内容已经错位）。
        setState((prev) => reduceHistory(prev, frame.threadId, frame.events))
        return
      }
      if (frame.type === "notice") {
        setNotice(frame.text)
        return
      }
      if (frame.type === "reset") {
        refs.current.stream = resetStream()
        setNotice(frame.reason)
        refs.current.transport?.send({ type: "hello" })
      }
    },
    [advance],
  )

  useConnection({ token, refs, onFrame, setConn, setMe })

  const send = useCallback((command: Command): boolean => {
    const sent = refs.current.transport?.send({ type: "command", command }) ?? false
    if (!sent) setNotice("现在没连上 omni，这一下没有发出去。等连上再点一次。")
    return sent
  }, [])

  const watch = useCallback((threadId: ThreadId | null): void => {
    // **相同就不发。** 这条帧本来就该只在「换了一条会话」时出现一次；
    // 调用方那侧只要有一个不稳定的依赖，它就会变成一秒几十帧的上行
    if (refs.current.watching === threadId) return
    refs.current.watching = threadId
    refs.current.transport?.send({ type: "watch", threadId })
  }, [])

  const retry = useCallback((): void => {
    refs.current.transport?.poke()
  }, [])

  const dismissNotice = useCallback((): void => {
    setNotice(undefined)
  }, [])

  return { state, conn, me, send, watch, retry, notice, dismissNotice }
}

/** 连接的生老病死。**单独一个 hook**：`useRemote` 已经贴着行数闸门。 */
function useConnection(deps: {
  token: string
  refs: { current: Refs }
  onFrame: (frame: ServerFrame) => void
  setConn: (state: ConnState) => void
  setMe: (me: Me) => void
}): void {
  const { token, refs, onFrame, setConn, setMe } = deps
  useEffect(() => {
    if (token === "") return undefined
    const transport = createTransport({
      token,
      authorize: async () => {
        const seen = await whoAmI(token)
        if (seen.kind === "ok") setMe(seen.me)
        return seen.kind
      },
      onFrame,
      onState: setConn,
      hello: () => {
        const { lastSeq, epoch } = refs.current.stream
        // 重连时把观察目标一并重报：宿主那边的会话是新的，它不知道我在看谁
        queueMicrotask(() => {
          refs.current.transport?.send({ type: "watch", threadId: refs.current.watching })
        })
        // **两个字段成对才有意义**：只报序号不报代号，宿主分不出这个游标
        // 是不是上一次运行留下的，只能当没带
        return lastSeq === undefined || epoch === undefined
          ? { type: "hello" }
          : { type: "hello", after: lastSeq, epoch }
      },
    })
    refs.current.transport = transport
    // 页面从后台回到前台时立刻探一次。手机上这是最常见的「看起来连着、其实早断了」。
    //
    // **切到后台时还要把「我在看这条」撤掉。** 宿主拿这个当「有人正看着」的判据，
    // 用来抑制推送——而你把手机锁屏揣兜里之后，这条连接往往还开着。
    // 不撤的话，你最需要的那条「等你确认」恰恰被自己静音了。
    const wake = (): void => {
      const visible = document.visibilityState === "visible"
      if (visible) transport.poke()
      transport.send({ type: "watch", threadId: visible ? refs.current.watching : null })
    }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("online", wake)
    return () => {
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("online", wake)
      transport.close()
      refs.current.transport = undefined
      // **定时器要跟着连接一起收**，否则换令牌时它还会往一个已经关掉的连接上发
      if (refs.current.ackTimer !== undefined) clearTimeout(refs.current.ackTimer)
      refs.current.ackTimer = undefined
      refs.current.stream = initialStream
    }
  }, [token, onFrame, refs, setConn, setMe])
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
