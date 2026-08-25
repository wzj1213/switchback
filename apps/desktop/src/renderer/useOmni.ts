import { useCallback, useEffect, useRef, useState } from "react"
import type { Command } from "@omni/protocol"
import { initial, reduceAll, type ViewState } from "@omni/store"
import {
  initialStream,
  received,
  replayed,
  reset,
  resynced,
  type Sealed,
  type Step,
  type Stream,
} from "@omni/wire"

export interface Omni {
  state: ViewState
  send: (command: Command) => void
  /** 告诉主进程当前正文是哪条会话，只用于抑制眼前这条的系统通知。 */
  viewing: (threadId: string | undefined) => void
  /** 弹系统目录框。桥没接上时返回 undefined，调用方按「用户取消」处理即可。 */
  pickFolder: () => Promise<string | undefined>
  /** 给一条不属于任何项目的对话要一个目录。 */
  chatDir: () => Promise<string>
  /** 订阅菜单动作。返回退订函数。 */
  onMenu: (handler: (action: string) => void) => () => void
  /** 页内查找。桥没接上时永远是 0/0。 */
  find: (query: string, next: boolean, forward: boolean) => Promise<{ active: number; total: number }>
  stopFind: () => void
  /** 写系统剪贴板 */
  copy: (text: string) => void
  /** 在访达里定位一个路径。只定位，不打开。 */
  reveal: (path: string) => void
  /** 工作区内的文件模糊搜索，给 `@` 用 */
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /**
   * preload 没注入通道。**显式暴露而不是静默 no-op**：
   * 桥断了会表现成「界面全都在、点什么都没反应」，那是最难查的一类故障。
   */
  bridgeMissing: boolean
  /**
   * 最近一条**增量里**新开的会话，带递增序号。
   *
   * 序号是必须的：调用方要等的是「我点下新建**之后**冒出来的那个」，
   * 光有 id 分不出「又来一个」和「还是上次那个」。
   */
  lastStarted: { id: string; seq: number } | undefined
}

const NOOP_VIEWING = (): void => undefined

/**
 * 订阅主进程的事件流，用 `@omni/store` 的归约器维护视图状态。
 *
 * 渲染层和宿主跑**同一个归约器**——两边状态不会漂移。
 * 这里只做订阅与转发，任何「状态该怎么变」的判断都不属于渲染层。
 */
export function useOmni(): Omni {
  const [state, setState] = useState<ViewState>(initial)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  // 游标放 ref 不放 state：它每来一批都变，进 state 会多一轮渲染，
  // 而界面上没有任何东西显示它
  const stream = useRef<Stream>(initialStream)
  /**
   * 最近一条**新开的**会话 id。
   *
   * 用来把「新建会话」这个动作和它的结果接上：点下去的那一刻还没有 id，
   * 会话是宿主起好之后才回来的。上一版的做法是「把选中清空，让排序把新的顶到第一位」
   * ——**靠排序碰运气**：只要排序规则一改（置顶、按项目分组、最近段），
   * 点了新建就会跳到一个别的会话上，而且不报错。
   */
  const [lastStarted, setLastStarted] = useState<{ id: string; seq: number } | undefined>(undefined)

  useEffect(() => {
    if (bridge === undefined) return undefined

    /**
     * 走一步：应用能连上的，缺了就去补。
     *
     * 补发是异步的，回来时再走一次这个函数——所以它必须能被自己调用。
     * 补不了就重载页面：那会触发主进程的一次全量重建，是唯一能重新对上号的路。
     */
    const advance = (step: Step): void => {
      stream.current = step.stream
      // 一批一次 setState：主进程已经合过帧，这里再逐条 set 就白合了
      if (step.apply.length > 0) setState((prev) => reduceAll(prev, step.apply))
      // 只认增量里的新会话。全量重建里也有一堆 `thread.started`，
      // 那是历史，不是「刚刚新开的」——认了的话每次重载都会跳到最后一条历史上
      const started = step.apply.filter((e) => e.type === "thread.started")
      const latest = started[started.length - 1]
      // **带一个递增序号**。只给 id 的话，调用方没法区分「又开了一个」和
      // 「还是刚才那个」——而它需要这个区别：等的是**下一个**，不是最近一个
      if (latest?.type === "thread.started") {
        const id = latest.thread.id
        setLastStarted((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }))
      }
      if (step.resyncFrom === undefined) return
      const epoch = stream.current.epoch
      if (epoch === undefined) return
      void bridge.resync(step.resyncFrom, epoch).then((answer) => {
        if ("reset" in answer) {
          stream.current = reset()
          window.location.reload()
          return
        }
        advance(resynced(stream.current, answer.events))
      })
    }

    const offEvents = bridge.subscribe((sealed: readonly Sealed[]) => {
      advance(received(stream.current, sealed))
    })
    const offReplay = bridge.onReplay((replay) => {
      // 全量是「世界现在长什么样」，不是增量——先把归约器清回初始态，
      // 否则重载之后新旧两份历史会叠在一起
      setState(initial)
      advance(replayed({ ...stream.current, lastSeq: undefined }, replay))
      setLastStarted(undefined)
    })
    // **两个监听都挂好之后**才喊「我准备好了」。反过来（主进程一加载完就推）
    // 会把全量发进空气里——重载之后界面是空的，而磁盘上会话都在
    bridge.hello()
    return () => {
      offEvents()
      offReplay()
    }
  }, [bridge])

  const send = useCallback(
    (command: Command) => {
      bridge?.send(command)
    },
    [bridge],
  )

  const pickFolder = useCallback(
    async () => (bridge === undefined ? undefined : bridge.pickFolder()),
    [bridge],
  )

  const onMenu = useCallback(
    (handler: (action: string) => void) => bridge?.onMenu(handler) ?? ((): void => undefined),
    [bridge],
  )

  const find = useCallback(
    async (query: string, next: boolean, forward: boolean) =>
      (await bridge?.find({ query, next, forward })) ?? { active: 0, total: 0 },
    [bridge],
  )
  const stopFind = useCallback(() => {
    bridge?.stopFind()
  }, [bridge])

  const copy = useCallback(
    (text: string) => {
      bridge?.copy(text)
    },
    [bridge],
  )

  const reveal = useCallback(
    (path: string) => {
      bridge?.reveal(path)
    },
    [bridge],
  )

  const searchFiles = useCallback(
    async (cwd: string, query: string) => (await bridge?.searchFiles(cwd, query)) ?? [],
    [bridge],
  )

  return {
    lastStarted,
    state,
    send,
    viewing: bridge?.viewing ?? NOOP_VIEWING,
    pickFolder,
    onMenu,
    find,
    stopFind,
    copy,
    reveal,
    searchFiles,
    chatDir: async () => (await bridge?.chatDir()) ?? "",
    bridgeMissing: bridge === undefined,
  }
}
