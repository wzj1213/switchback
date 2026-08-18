import { useState } from "react"
import type { Command, Item, ToolCallItem } from "@omni/protocol"
import { Markdown } from "./Markdown.js"
import { Approval } from "./Approval.js"
import { ToolRow } from "./ToolRow.js"

/**
 * 一条 item 怎么画。
 *
 * 七种 item 里，**手机上真正需要读全的只有三种**：模型的话、审批卡、错误。
 * 思考默认折起来（它长、且多数时候是过程噪声），工具调用收成一行
 * （要看输出再点开）。这不是偷懒——一块 390 点宽的屏幕上，把七种东西
 * 一样重地摊开，等于什么都读不到。
 */

function Reasoning({ text, complete }: { text: string; complete: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="item item--reasoning">
      <button className="fold" type="button" onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <span className="fold__caret" data-open={open} aria-hidden="true">
          ›
        </span>
        思考{complete ? "" : "中…"}
      </button>
      {open ? <pre className="reasoning__text">{text}</pre> : null}
    </div>
  )
}

export function ItemView({
  item,
  send,
  offline,
}: {
  item: Item
  send: (command: Command) => boolean
  offline: boolean
}): React.JSX.Element | null {
  if (item.kind === "user_message") {
    return (
      <div className="item item--user">
        <div className="bubble">{item.text}</div>
      </div>
    )
  }
  if (item.kind === "agent_message") {
    return (
      <div className="item item--agent">
        <Markdown text={item.text} />
        {item.complete ? null : <span className="caret" aria-hidden="true" />}
      </div>
    )
  }
  if (item.kind === "reasoning") return <Reasoning text={item.text} complete={item.complete} />
  if (item.kind === "tool_call") return <ToolRow item={item satisfies ToolCallItem} />
  if (item.kind === "approval") return <Approval item={item} send={send} offline={offline} />
  if (item.kind === "plan") {
    return (
      <ol className="item item--plan">
        {item.steps.map((step, i) => (
          <li key={`${String(i)}-${step.text}`} data-status={step.status}>
            {step.text}
          </li>
        ))}
      </ol>
    )
  }
  return (
    <div className="item item--error" role="alert">
      {item.message}
    </div>
  )
}
