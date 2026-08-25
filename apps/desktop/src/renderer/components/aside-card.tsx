import type { Aside, Lane } from "@omni/protocol"
import { PlanMark, type MarkState } from "./PlanMark.js"

const ASIDE_LABEL: Readonly<Record<Lane["status"], string>> = {
  running: "回答中", paused: "已暂停", done: "已回答", failed: "失败",
}

const ASIDE_MARK: Readonly<Record<Lane["status"], MarkState>> = {
  running: "in_progress", paused: "pending", done: "done", failed: "failed",
}

/**
 * 转录区里的一次侧问，落在它被问的那个位置上。
 *
 * **虚线、缩进、和正文明显不是一层**：它确实不属于这条会话的正文——
 * 发给引擎的上下文里没有它（见 `Thread.asides` 的注释）。但那条原则说的是
 * **模型下一轮读什么**，不是**你看得见什么**：你问的常常正是屏幕上这一段，
 * 答案就该待在旁边，滚回去还在、能对着当时的上下文读。
 *
 * 上一版把问答关在一个点掉就没的浮层里——而它回答的正是你屏幕上正在做的事。
 */
export function AsideCard({ aside }: { aside: Aside }): React.JSX.Element {
  return (
    <div className="asidecard">
      <span className="asidecard__tag">侧问 · 不进正文</span>
      <p className="asidecard__q">{aside.question}</p>
      <p className="asidecard__a">{aside.answer}</p>
    </div>
  )
}

/** 新侧问走一等旁路：问题立即出现，答案回来后同卡替换；老 `Thread.asides` 仍由上面兼容。 */
export function AsideLaneCard({
  lane,
  live,
  onOpen,
  folded = false,
}: {
  lane: Lane
  live: boolean
  onOpen?: (laneId: string) => void
  folded?: boolean
}): React.JSX.Element {
  const running = lane.status === "running"
  const spinning = running && live
  const state = running && !live ? "状态待确认" : ASIDE_LABEL[lane.status]
  return (
    <section className={`asidecard asidecard--${lane.status}`} aria-label={`侧问：${lane.title}`} aria-live="polite">
      <span className="asidecard__tag">
        <PlanMark status={ASIDE_MARK[lane.status]} spinning={spinning} />
        侧问 · {state} · 不进正文
      </span>
      <p className="asidecard__q">{lane.title}</p>
      {onOpen === undefined ? null : (
        <button type="button" className="lane__open" onClick={() => { onOpen(lane.id) }}>
          {folded ? "在旁路里看着" : "在旁路查看"}
        </button>
      )}
      {running || folded ? null : <p className="asidecard__a">{lane.summary}</p>}
    </section>
  )
}
