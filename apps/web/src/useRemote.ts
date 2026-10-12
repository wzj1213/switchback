import { useCallback, useEffect, useRef, useState } from "react"
import type { Command, ThreadId } from "@switchback/protocol"
import { initial, reduceAll, reduceHistory, type ViewState } from "@switchback/store"
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
} from "@switchback/wire"
import { createTransport, tokenOf, whoAmI, type ConnState, type Me, type Transport } from "@switchback/link"

/**
 * 事件流 → 视图状态。**和桌面端跑的是同一个归约器**（`@switchback/store`），
 * 所以两端不会漂移：手机上看到的「正在跑」和桌面上那条是同一次判断。
 *
 * 补洞那套（`@switchback/wire` 的 `received` / `replayed` / `resynced`）也是同一份。
 * 这一端多出来的只有两件事：**确认**（桌面那条 IPC 不会丢，这条会）
 * 和**去补**（发现序号跳了要主动要那一段）。
 */

/** 攒多久发一次 ack。太密是白发（一次 `pnpm build` 能刷上千条），太疏则保留缓冲白留。 */
const ACK_EVERY_MS = 1000

export interface Remote {
  state: ViewState
  conn: ConnState
  /**
   * 基线到了没有。
   *
   * **「还没到」和「真的是空的」必须分得开。** 分不开的代价是界面在基线
   * 还在路上时说一句确定的假话（「还没有会话。到桌面上新建一条」），
   * 而用户的反应是退出重开——重开会打断正在传的那份全量，回到起点。
   */
  hydrated: boolean
  /**
   * 这些会话的正文到手了。其余的要么还没打开过，要么正在路上。
   *
   * 来源两处：全量帧里的 `bodies`（宿主报的「这一份带了谁的正文」），
   * 以及事后单独补的 `thread` 帧。
   */
  loaded: ReadonlySet<ThreadId>
  /**
   * 这些会话**只带了尾巴**，开头被裁掉了。
   *
   * 转录区据此在最上面画一条「更早的内容没有加载」。少了这一条，
   * 一条三小时的会话看起来就是「从中间开始的」，而没有任何东西说上面还有——
   * **用户会以为记录丢了**。
   */
  trimmed: ReadonlySet<ThreadId>
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
  /** 被宿主拒掉、原样还回来的那句话。那条会话的输入框收下之后调 `takeReturned`。 */
  returned: Returned | undefined
  takeReturned: (id: number) => void
}

export interface Returned {
  /** 同一句话被拒两次也要各还一次，靠它分。 */
  id: number
  threadId: ThreadId
  text: string
}

interface Refs {
  stream: Stream
  transport: Transport | undefined
  ackTimer: ReturnType<typeof setTimeout> | undefined
  watching: ThreadId | null
  /** 还回来的话编到第几号了。 */
  returns: number
}

export function useRemote(token: string): Remote {
  const [state, setState] = useState<ViewState>(initial)
  const [conn, setConn] = useState<ConnState>({ kind: "connecting" })
  const [hydrated, setHydrated] = useState(false)
  const [loaded, setLoaded] = useState<ReadonlySet<ThreadId>>(() => new Set())
  const [trimmed, setTrimmed] = useState<ReadonlySet<ThreadId>>(() => new Set())
  const [me, setMe] = useState<Me | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [returned, setReturned] = useState<Returned | undefined>(undefined)
  const refs = useRef<Refs>({ stream: initialStream, transport: undefined, ackTimer: undefined, watching: null, returns: 0 })

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
        // 能收增量说明宿主认了我手上的游标——也就是基线本来就在
        setHydrated(true)
        advance(received(refs.current.stream, frame.sealed))
        return
      }
      if (frame.type === "catchup") {
        setHydrated(true)
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
        setHydrated(true)
        // **每来一份新全量就换一套**：新那份带的正文可能是另外几条
        setLoaded(new Set(frame.replay.bodies ?? []))
        setTrimmed(new Set(frame.replay.trimmed ?? []))
        return
      }
      if (frame.type === "thread") {
        // **把这条会话的正文整段换掉**（`reduceHistory` 是清空重建，不是「只补没有的」）。
        //
        // 这是一份**历史快照**，而宿主发它之前已经 flush 过磁盘，所以它就是那一刻的全量；
        // 读完之后新产生的照常从事件流上来，追加在后面，顺序自然是对的。
        // 换而不是合，是因为合会把更早的历史追加在已经流过来的那几条**后面**——
        // 转录区于是变成「最新的排在最前」，中间还夹着旧的。
        setState((prev) => reduceHistory(prev, frame.threadId, frame.events))
        setLoaded((prev) => new Set(prev).add(frame.threadId))
        setTrimmed((prev) => {
          const next = new Set(prev)
          // 补来的那一份可能是完整的（这次没超限），那就把旧的标记撤掉
          if (frame.trimmed === true) next.add(frame.threadId)
          else next.delete(frame.threadId)
          return next
        })
        return
      }
      if (frame.type === "notice") {
        setNotice(frame.text)
        if (frame.returned !== undefined) {
          refs.current.returns += 1
          setReturned({ ...frame.returned, id: refs.current.returns })
        }
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
    if (!sent) setNotice("现在没连上 Switchback，这一下没有发出去。等连上再点一次。")
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

  const takeReturned = useCallback((id: number): void => {
    setReturned((prev) => (prev?.id === id ? undefined : prev))
  }, [])

  return { state, conn, hydrated, loaded, trimmed, me, send, watch, retry, notice, dismissNotice, returned, takeReturned }
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
