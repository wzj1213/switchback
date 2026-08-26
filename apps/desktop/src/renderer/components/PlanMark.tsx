import type { PlanStep } from "@omni/protocol"
import { LINE, Svg } from "./icon-base.js"

/**
 * 这枚环能画的全部状态。
 *
 * **比 `PlanStep["status"]` 多一个 `failed`**：旁路的节点会失败，而待办清单里没有
 * 「这一步炸了」这个概念（模型自己写的清单只有做没做）。加在这儿而不是另画一枚，
 * 是因为它们出现在同一种列里——`PlanSteps.tsx` 顶上那句「两处别把当前步画成
 * 两套语言」正是为此留的，上一版已经失效过一次。
 *
 * `PlanStep["status"]` 天然可赋值给它，所以既有调用点一个字都不用改。
 */
export type MarkState = PlanStep["status"] | "failed"

/**
 * 计划的步态标记：四个字形换成同一枚环的四个状态——
 * pending 空环 / in_progress 转圈 / done 实心 / dropped 环加一杠。
 * 四态直径相同、光学重量相同，标记列一个像素都不动。
 *
 * 胶囊、浮层、正文里的 PlanCard 三处共用——`PlanSteps.tsx` 顶上那句
 * 「两处别把当前步画成两套语言」的注释，在上一版已经失效过一次。
 *
 * ## 转圈只在真的在跑时转
 *
 * 浮层里同时最多一枚 in_progress；而 `PlanCard` 是**历史快照**——里面的
 * in_progress 是当时的状态，不是现在。快照里的环不许转：
 * 转了就是在说一件早就结束的事正在发生。所以 `spinning` 由调用方给。
 *
 * 动画照仓库现成那条 `row-spin`（900ms linear），不另立一套；
 * 跟着它的还有 `prefers-reduced-motion` 那一档（见 plan.css）。
 */
export function PlanMark({
  status,
  spinning,
}: {
  status: MarkState
  /** 是不是活状态。历史快照传 false：环画成 3/4 静弧，信息不丢，只是不动。 */
  spinning: boolean
}): React.JSX.Element {
  return (
    <Svg
      size={11}
      className={`plan-mark${status === "in_progress" && spinning ? " plan-mark--spin" : ""}`}
    >
      {status === "done" ? (
        <circle cx="8" cy="8" r="5.4" fill="currentColor" stroke="none" />
      ) : status === "failed" ? (
        // 环 + 叉。**直径和其余四态一样**，标记列一个像素都不动
        <>
          <circle cx="8" cy="8" r="5.4" opacity=".45" {...LINE} />
          <path d="M6.1 6.1l3.8 3.8M9.9 6.1l-3.8 3.8" {...LINE} />
        </>
      ) : status === "dropped" ? (
        <>
          <circle cx="8" cy="8" r="5.4" opacity=".4" {...LINE} />
          <path d="M5.6 10.4l4.8-4.8" opacity=".7" {...LINE} />
        </>
      ) : status === "in_progress" ? (
        <>
          <circle cx="8" cy="8" r="5.4" opacity=".28" {...LINE} />
          <path d="M8 2.6a5.4 5.4 0 0 1 5.4 5.4" {...LINE} />
        </>
      ) : (
        <circle cx="8" cy="8" r="5.4" opacity=".45" {...LINE} />
      )}
    </Svg>
  )
}
