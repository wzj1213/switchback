import { useCallback, useEffect, useState } from "react"

/**
 * 「问主进程要一份东西」的那一套。
 *
 * ## 为什么值得一个 hook
 *
 * 设置面板里有五处在做同一件事（引擎版本、配置来源、DSH profile、钩子、活动统计），
 * 而它们各写了一遍，**每一遍都少了一样**：
 *
 * - `EngineDoors` 有 `live` 卫兵、没有「重新读」；
 * - `EngineVersions` 有「重新检查」、没有 `live` 卫兵——切走再切回来时，
 *   上一次的 Promise 落回来照样 `setState`，React 在开发模式下当场告警；
 * - `DshProfileSettings` 用一个自增的 nonce 做重读，`useEnvConfig` 也各写了一份；
 * - 三处的失败处理各不相同：一处吞掉、一处只置空、一处画红字。
 *
 * 收成一个 hook 之后，**卫兵和失败态是默认带的**，不是每处都要记得写的纪律。
 *
 * ## 三态必须分得出来
 *
 * `data === undefined && !failed` 是「还在读」，`failed` 是「读挂了」，
 * 都不是「读到了但里面是空的」。合并成两态的下场是一个读失败的面板
 * 显示「没有内容」——用户会据此停止排查。
 */
export interface Async<T> {
  data: T | undefined
  /** 正在读。**第一次和重读都算**——按钮据此变灰，免得连点。 */
  loading: boolean
  failed: boolean
  /** 再读一遍。连点两次就真的读两次。 */
  reload: () => void
}

/**
 * `load` **必须是稳定引用**（`useMemo` / `useCallback` 包一层，或者定义在组件外）：
 * 每次渲染都新造一个函数会让这里每一帧都重读一次。
 *
 * `again` 说的是「**这一次是人点了重来**」，不是第一次挂载。
 * 好几处的重来和首读走的不是同一条路——引擎版本要无视六小时缓存重探，
 * 活动统计要无视三十秒缓存重扫。没有这个参数的话，调用方只能在 `reload()`
 * 旁边**再自己发一次强制请求**，于是两条请求赛跑，赢的那条往往是拿着旧缓存的那条。
 */
export function useAsync<T>(load: ((again: boolean) => Promise<T>) | undefined): Async<T> {
  const [state, setState] = useState<{ data?: T; loading: boolean; failed: boolean }>({
    loading: load !== undefined,
    failed: false,
  })
  // 计数而不是布尔：连点两次「重新读」应该真的读两次
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (load === undefined) {
      setState({ loading: false, failed: false })
      return undefined
    }
    let live = true
    setState((previous) => ({ ...previous, loading: true, failed: false }))
    void load(nonce > 0).then(
      (data) => {
        if (live) setState({ data, loading: false, failed: false })
      },
      () => {
        // **上一次读到的东西留着不擦。** 重读失败时把界面清空，等于用一次网络抖动
        // 换掉一屏还有效的内容；旁边的失败提示已经说清楚这一份可能是旧的
        if (live) setState((previous) => ({ ...previous, loading: false, failed: true }))
      },
    )
    return () => {
      live = false
    }
  }, [load, nonce])

  return {
    data: state.data,
    loading: state.loading,
    failed: state.failed,
    reload: useCallback(() => {
      setNonce((n) => n + 1)
    }, []),
  }
}

/** 渲染层拿桥的那一句。到处 `typeof window === "undefined"` 判一遍太吵。 */
export function bridge(): Window["switchback"] {
  return typeof window === "undefined" ? undefined : window.switchback
}
