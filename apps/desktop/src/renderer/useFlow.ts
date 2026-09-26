import { useEffect, useRef } from "react"
import type { ThreadId } from "@omni/protocol"
import type { Sealed } from "@omni/wire"
import { clearRun, createRun, speedOf, type Bench } from "./bench.js"
import { createScope, drain, retarget } from "./flow-scope.js"
import { clearTapeText, createTapeText, nextChar } from "./tape-text.js"
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
 * ## 为什么返回好几个数
 *
 * `rate` 是**速度表**（最近 1.2 秒多快，驱动开火节奏），`speed` 是这一轮**此刻的生成速度**
 *（业界口径：生成量 ÷ 真在出字的时间），`last` 是**上一轮的成绩**（TTFT 和 tok/s，
 * 引擎报得出真 token 时就是真数）。三个都从同一条事件流上来，但回答的是不同的问题——
 * **合成一个数就一定会有人拿速度表的读数去对账**，所以它们从这儿出去就是分开的。见 `bench.ts`。
 * `nextChar` 给纸带取字：模型刚写出来的那些字（`tape-text.ts`）。
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
/** 此刻的一切。见 `useFlow` 里那段「为什么返回两个数」。 */
export interface Flow {
  /** 最近 1.2 秒的流速（token/秒，**估**）。开火节奏按它走。 */
  rate: number
  /** 这一轮此刻的生成速度（token/秒），业界口径。还没攒够时缺席。 */
  speed: number | undefined
  /** 上一轮的成绩。这条会话还没跑完过一轮时缺席。 */
  last: Bench | undefined
  /** 纸带上下一发落哪个字。 */
  nextChar: () => string
}

export function useFlow(thread: ThreadId | undefined): () => Flow {
  const meter = useRef(createMeter())
  const scope = useRef(createScope())
  const run = useRef(createRun())
  const tape = useRef(createTapeText())

  useEffect(() => {
    retarget(scope.current, thread)
    // 换会话就把窗口和账本都清空：上一条的流速和成绩都不属于这一条
    clearMeter(meter.current)
    clearRun(run.current)
    clearTapeText(tape.current)
  }, [thread])

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (bridge === undefined) return undefined
    return bridge.subscribe((sealed: readonly Sealed[]) => {
      drain(scope.current, { meter: meter.current, run: run.current, tape: tape.current }, sealed, performance.now())
    })
  }, [])

  const take = useRef(() => nextChar(tape.current)).current
  return useRef(
    (): Flow => ({
      rate: rateOf(meter.current, performance.now(), run.current.scale),
      speed: run.current.till === undefined ? speedOf(run.current) : undefined,
      last: run.current.done,
      nextChar: take,
    }),
  ).current
}
