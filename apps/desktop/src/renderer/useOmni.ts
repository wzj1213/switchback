import { useCallback, useEffect, useState } from "react"
import type { Command } from "@omni/protocol"
import { initial, reduceAll, type ViewState } from "@omni/store"

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

  useEffect(() => {
    if (bridge === undefined) return undefined
    // 一批一次 setState：主进程已经合过帧，这里再逐条 set 就白合了
    return bridge.subscribe((events) => {
      setState((prev) => reduceAll(prev, events))
    })
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
    searchFiles,
    bridgeMissing: bridge === undefined,
  }
}
