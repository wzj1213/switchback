import { useEffect, useRef, useState } from "react"

/**
 * 「已经发出去、还没等到引擎回声」的那一档。
 *
 * ## 为什么它不能住在展开的条子里
 *
 * 上一版把它放在 `EffortBar`（展开后那条）里：落档 → 记一个本地 `pendingIndex`
 * → 等 `thread.effort` 追上来再撤。**而条子一收起就卸载了**，那份本地落点跟着没。
 * 于是最常见的那一串动作——点开、拖到 ultracode、马上点走——收起来的触发器
 * 上写的还是「轻度」，要等引擎那趟往返（`thread.setModel` 进的是
 * `configure:<thread>` 那条串行队列，再 await 引擎自己的 setter）回来才变。
 * 实测那是好几秒，而这几秒里界面在撒谎：**它显示的是你刚刚亲手改掉的那一档**。
 *
 * 所以它必须住在**收起和展开都活着**的那一层，也就是 `EffortSlider`。
 *
 * ## 为什么还要一道超时
 *
 * 「回声等于我发的那一档」是撤销的正路。但引擎有权不认：ZCode 那类桥会把
 * 设不上的档位原样拒掉，宿主据此把 `thread.effort` 清成 undefined
 *（见 `host/session.ts` 的 `setModel`）——那个值永远不会等于 pending，
 * 于是乐观档位就永久留在屏幕上，**从「慢几秒」变成「一直错」**。
 *
 * 超时到了就交回真值。它不是给正常路径用的（正常路径几百毫秒就回声了），
 * 是给「引擎拒了」这条路兜底的：宁可晚几秒说实话，不要一直说假话。
 */
const SETTLE_MS = 10_000

export function useEffortPending(effort: string | undefined): {
  /** 乐观档位；没有在途的落档时缺席。 */
  pending: string | undefined
  /** 刚刚落了一档，命令已经发出去。 */
  mark: (next: string) => void
} {
  const [pending, setPending] = useState<string>()
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )
  // 连着点两档时，第一档的较早回声不能把第二档的本地反馈清掉——只认自己那一档
  useEffect(() => {
    setPending((shown) => (shown === effort ? undefined : shown))
  }, [effort])
  return {
    pending,
    mark: (next) => {
      setPending(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setPending(undefined)
      }, SETTLE_MS)
    },
  }
}

/**
 * 现在该画哪一档。三层，从最「当下」往最「确凿」退：手指指着的 →
 * 已落档还没回声的 → 引擎确认过的 → 模型默认 → 清单第一档。
 *
 * 纯函数摆在这里是为了能穷举测：这几层的先后正是上一版翻车的地方，
 * 而「收起之后显示的是哪一档」没有别的办法验。
 */
export function shownEffort(layers: {
  preview?: string | undefined
  pending?: string | undefined
  effort?: string | undefined
  defaultEffort?: string | undefined
  efforts: readonly string[]
}): string | undefined {
  return layers.preview ?? layers.pending ?? layers.effort ?? layers.defaultEffort ?? layers.efforts[0]
}
