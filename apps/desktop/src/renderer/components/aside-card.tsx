import type { Aside } from "@omni/protocol"

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
