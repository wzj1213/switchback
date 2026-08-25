import { useEffect, useRef } from "react"
import type { ThreadId } from "@omni/protocol"
import type { Sealed } from "@omni/wire"
import { createScope, drain, retarget } from "./flow-scope.js"
import { clearMeter, createMeter, rateOf } from "./throughput.js"

/**
 * 这一条会话此刻吐得多快（token/秒）。
 *
 * ## 为什么自己订一份，而不是搭 `useOmni` 的车
 *
 * `useOmni` 那条路上的每一步都要**改 React 状态**：它维护的是「界面该长什么样」，
 * 一批事件进来 `setState` 一次。而流速是**每帧读一次的数**，不该让它经过一次
 * 重渲染——一秒六十次重渲染，只为把一个数字送给一张 canvas。
 *
 * 桥那头是 `ipcRenderer.on`，本来就允许挂多个监听。于是这一层完整地独立：
 * **不碰 `useOmni`、不碰 store、不碰归约器**，关掉它的时候那三样一无所知。
 *
 * ## 返回函数而不是数
 *
 * 返回数就得存进 state，存进 state 就是每帧一次重渲染——正是上面要躲的。
 * 返回一个稳定的取值函数，调用方在自己的 rAF 里读。
 *
 * ## 时间戳用收到的时刻，不用 `event.at`
 *
 * `event.at` 是**引擎那边发生的时刻**（墙钟），而这里要答的是「此刻到我这儿多快」。
 * 两者混用还有个更硬的问题：`event.at` 是 `Date.now()` 系，滑窗读的是
 * `performance.now()` 系，差着一个纪元——混在一起窗口永远是空的。
 *
 * 也**不订阅 `onReplay`**：全量重放是历史，而历史没有「此刻」。
 * 订了的话每次开窗都会先炸出一波假流速。
 */
export function useFlow(thread: ThreadId | undefined): () => number {
  const meter = useRef(createMeter())
  const scope = useRef(createScope())

  useEffect(() => {
    retarget(scope.current, thread)
    // 换会话就把窗口清空：上一条的流速不属于这一条
    clearMeter(meter.current)
  }, [thread])

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (bridge === undefined) return undefined
    return bridge.subscribe((sealed: readonly Sealed[]) => {
      drain(scope.current, meter.current, sealed, performance.now())
    })
  }, [])

  return useRef(() => rateOf(meter.current, performance.now())).current
}
