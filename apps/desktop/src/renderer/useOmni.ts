import { useCallback, useEffect, useState } from "react"
import type { Command } from "@omni/protocol"
import { initial, reduce, type ViewState } from "@omni/store"

export interface Omni {
  state: ViewState
  send: (command: Command) => void
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
    return bridge.subscribe((event) => {
      setState((prev) => reduce(prev, event))
    })
  }, [bridge])

  const send = useCallback(
    (command: Command) => {
      bridge?.send(command)
    },
    [bridge],
  )

  return { state, send, bridgeMissing: bridge === undefined }
}
