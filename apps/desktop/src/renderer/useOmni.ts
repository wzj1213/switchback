import { useCallback, useEffect, useRef, useState } from "react"
import type { Command } from "@omni/protocol"
import { initial, reduceAll, type ViewState } from "@omni/store"
import { initialStream, received, replayed, reset, resynced, type Sealed, type Step, type Stream } from "./stream.js"

export interface Omni {
  state: ViewState
  send: (command: Command) => void
  /** 弹系统目录框。桥没接上时返回 undefined，调用方按「用户取消」处理即可。 */
  pickFolder: () => Promise<string | undefined>
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
}

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
      if (step.resyncFrom === undefined) return
      void bridge.resync(step.resyncFrom).then((answer) => {
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
    })
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
    state,
    send,
    pickFolder,
    onMenu,
    find,
    stopFind,
    copy,
    reveal,
    searchFiles,
    bridgeMissing: bridge === undefined,
  }
}
