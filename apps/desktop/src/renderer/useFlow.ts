import { useEffect, useRef } from "react"
import type { ThreadId } from "@switchback/protocol"
import { createPaceBook, livePace } from "@switchback/store"
import type { Sealed } from "@switchback/wire"
import { createScope, drain, retarget } from "./flow-scope.js"
import { clearTapeText, createTapeText, nextChar } from "./tape-text.js"
import { clearMeter, createMeter, rateOf } from "./throughput.js"

/**
 * 这一条会话此刻吐得多快（token/秒）。
 *
 * ## 为什么自己订一份，而不是搭 `useSwitchback` 的车
 *
 * `useSwitchback` 那条路上的每一步都要**改 React 状态**：它维护的是「界面该长什么样」，
 * 一批事件进来 `setState` 一次。而流速是**每帧读一次的数**，不该让它经过一次
 * 重渲染——一秒六十次重渲染，只为把一个数字送给一张 canvas。
 *
 * 桥那头是 `ipcRenderer.on`，本来就允许挂多个监听。于是这一层完整地独立：
 * **不碰 `useSwitchback`、不碰 store、不碰归约器**，关掉它的时候那三样一无所知。
 *
 * ## 返回函数而不是数
 *
 * 返回数就得存进 state，存进 state 就是每帧一次重渲染——正是上面要躲的。
 * 返回一个稳定的取值函数，调用方在自己的 rAF 里读。
 *
 * ## 为什么返回好几个数
 *
 * `rate` 是**速度表**（最近 1.2 秒多快，驱动开火节奏），`speed` 是这一轮**此刻的出字速度**
 *（和收工后分界线上印的那个同一个算法，见 `@switchback/store` 的 `pace.ts`）。两个都从同一条事件流上来，
 * 但回答的是不同的问题——**合成一个数就一定会有人拿速度表的读数去对账**，所以从这儿出去就是分开的。
 * 跑完的那一轮的成绩不从这儿出：它是宿主量好、跟着 `turn.completed` 落了盘的那一份，从 store 读。
 * `nextChar` 给纸带取字：模型刚写出来的那些字（`tape-text.ts`）。
 *
 * ## 两种时刻，各管各的
 *
 * 滑窗用**收到的时刻**（`performance.now()`）：它要答的是「此刻到我这儿多快」。
 * 节奏账本用**事件自己的 `at`**：它要和宿主量出来的对得上，两边就得用同一个钟。
 * 两个钟别混——`at` 是 `Date.now()` 系，和 `performance.now()` 差着一个纪元。
 *
 * 也**不订阅 `onReplay`**：全量重放是历史，而历史没有「此刻」。
 * 订了的话每次开窗都会先炸出一波假流速。
 */
/** 此刻的一切。见 `useFlow` 里那段「为什么返回两个数」。 */
export interface Flow {
  /** 最近 1.2 秒的流速（token/秒，**估**）。开火节奏按它走。 */
  rate: number
  /** 这一轮此刻的出字速度（token/秒）。没在跑、或者还没攒够时缺席。 */
  speed: number | undefined
  /** 纸带上下一发落哪个字。 */
  nextChar: () => string
}

export function useFlow(thread: ThreadId | undefined): () => Flow {
  const meter = useRef(createMeter())
  const scope = useRef(createScope())
  const book = useRef(createPaceBook())
  const tape = useRef(createTapeText())
  const target = useRef(thread)

  useEffect(() => {
    target.current = thread
    retarget(scope.current, thread)
    // 换会话就把窗口和纸带清空：上一条的流速不属于这一条。
    // 节奏账本不清——它本来就按会话分着记，换回来时那一轮还接得上
    clearMeter(meter.current)
    clearTapeText(tape.current)
  }, [thread])

  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.switchback
    if (bridge === undefined) return undefined
    return bridge.subscribe((sealed: readonly Sealed[]) => {
      drain(scope.current, { meter: meter.current, book: book.current, tape: tape.current }, sealed, performance.now())
    })
  }, [])

  const take = useRef(() => nextChar(tape.current)).current
  return useRef(
    (): Flow => ({
      rate: rateOf(meter.current, performance.now()),
      speed: target.current === undefined ? undefined : livePace(book.current, target.current)?.tps,
      nextChar: take,
    }),
  ).current
}
