import type { Aside, Lane } from "@switchback/protocol"
import { PlanMark, type MarkState } from "./PlanMark.js"
import { useMessages } from "../i18n.js"
import { ASIDE_CARD } from "./aside-card.messages.js"


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
  const m = useMessages(ASIDE_CARD)
  return (
    <div className="asidecard">
      <span className="asidecard__tag">{m.tag}</span>
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
  const m = useMessages(ASIDE_CARD)
  const running = lane.status === "running"
  const spinning = running && live
  const state = running && !live ? m.unknown : m.status[lane.status]
  return (
    <section className={`asidecard asidecard--${lane.status}`} aria-label={m.label(lane.title)} aria-live="polite">
      <span className="asidecard__tag">
        <PlanMark status={ASIDE_MARK[lane.status]} spinning={spinning} />
        {m.tagWith(state)}
      </span>
      <p className="asidecard__q">{lane.title}</p>
      {onOpen === undefined ? null : (
        <button type="button" className="lane__open" onClick={() => { onOpen(lane.id) }}>
          {folded ? m.opened : m.view}
        </button>
      )}
      {running || folded ? null : <p className="asidecard__a">{lane.summary}</p>}
    </section>
  )
}
