import { useState } from "react"
import type { ToolCallItem } from "@omni/protocol"
import { VERB, target } from "../tool.js"

/** 有内容可展开的才做成按钮；没有的渲染成静态行，避免出现点了没反应的元素。 */
function body(item: ToolCallItem): string | undefined {
  if (item.error !== undefined && item.error !== "") return item.error
  if (item.detail.kind === "shell") return item.detail.output
  if (item.detail.kind === "file_edit") return item.detail.diff
  return undefined
}

function Stat({ item }: { item: ToolCallItem }): React.JSX.Element {
  if (item.detail.kind === "file_edit" && item.status === "ok") {
    return (
      <span className="step__state">
        <span className="diffstat__add">+{item.detail.added}</span>{" "}
        <span className="diffstat__del">−{item.detail.removed}</span>
      </span>
    )
  }
  return <span className={`step__state step__state--${item.status}`}>{item.status}</span>
}

function Step({ item }: { item: ToolCallItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const content = body(item)
  const line = (
    <>
      <span className="step__verb">{VERB[item.detail.kind]}</span>
      <span className="step__target">{target(item.detail)}</span>
      <Stat item={item} />
    </>
  )
  if (content === undefined || content === "") return <div className="step">{line}</div>
  return (
    <>
      <button
        className={`step step--open${open ? " step--expanded" : ""}`}
        type="button"
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        {line}
      </button>
      {open ? <pre className="step__out">{content}</pre> : null}
    </>
  )
}

/**
 * 一段连续的工具活动。共用一条左轨，读起来是「一段活动」而不是一摞卡片。
 * 输出默认折叠——大多数时候你只想知道做了什么、成没成。
 */
export function ToolRun({ items }: { items: readonly ToolCallItem[] }): React.JSX.Element {
  return (
    <div className="run">
      {items.map((item) => (
        <Step key={item.id} item={item} />
      ))}
    </div>
  )
}
