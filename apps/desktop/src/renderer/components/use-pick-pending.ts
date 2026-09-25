import { useEffect, useRef, useState } from "react"

/**
 * 模型菜单里「已经选了、还没等到引擎回声」的那一对（模型 + 强度）。
 *
 * `thread.setModel` 进的是 `configure:<thread>` 那条串行队列，还要 await 引擎自己的
 * setter（见 host `session.ts` 的 `setModel`），实测好几秒。这几秒里按钮要是照
 * `thread.model` / `thread.effort` 画，写着的就是你刚刚亲手改掉的那一档——界面在撒谎。
 * 所以选完先记在这里，按钮照它画；回声对上了再交回真值。
 *
 * 这份状态原来住在输入区的强度滑块里，只管强度；滑块去掉之后强度只在模型菜单里改，
 * 它就搬到这儿，模型和强度一起管。切会话时整排控件按会话重建（`composer-body.tsx`
 * 的 `key`），这一份不会带到别的会话上。
 *
 * ## 为什么还要一道超时
 *
 * 引擎有权不认：ZCode 那类桥会把设不上的档位原样拒掉，宿主据此把 `thread.effort` 清掉——
 * 那个值永远对不上，乐观值就永久留在按钮上，从「慢几秒」变成「一直错」。
 * 超时到了就交回真值：宁可晚几秒说实话，不要一直说假话。
 */
const SETTLE_MS = 10_000

export interface Picked {
  model: string
  effort?: string
}

/** 引擎的回声对上了没有：模型一致；这次指定了强度的，强度也要一致。 */
export function echoed(pick: Picked, model: string | undefined, effort: string | undefined): boolean {
  return pick.model === model && (pick.effort === undefined || pick.effort === effort)
}

export function usePickPending(
  model: string | undefined,
  effort: string | undefined,
): {
  /** 乐观值；没有在途的选择时缺席。 */
  picked: Picked | undefined
  /** 刚选了这一对，命令已经发出去。和现在的真值一样时不记。 */
  mark: (next: Picked) => void
} {
  const [picked, setPicked] = useState<Picked>()
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )
  // 只认自己那一对：连着选两次时，第一次较早的回声不能把第二次的本地反馈清掉
  useEffect(() => {
    setPicked((shown) => (shown !== undefined && echoed(shown, model, effort) ? undefined : shown))
  }, [model, effort])
  return {
    picked,
    mark: (next) => {
      if (echoed(next, model, effort)) return
      setPicked(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setPicked(undefined)
      }, SETTLE_MS)
    },
  }
}
