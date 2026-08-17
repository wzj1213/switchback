import { useState } from "react"
import type { ToolCallItem, ToolDetail } from "@omni/protocol"

/**
 * 一次工具调用，收成一行。
 *
 * 手机上工具行是**数量最多**的一类 item，而多数时候你只需要知道
 * 「它在干什么、成没成」。所以默认一行，点开才展开输出或 diff。
 */

const STATUS_MARK: Readonly<Record<ToolCallItem["status"], string>> = {
  pending: "…",
  running: "…",
  ok: "✓",
  failed: "✕",
  denied: "⃠",
  interrupted: "◼",
}

/** 一行标题：说清「在干什么」，不说「用了哪个工具」。 */
function titleOf(detail: ToolDetail): string {
  switch (detail.kind) {
    case "shell":
      return detail.command
    case "file_edit":
      return `改 ${detail.path}${detail.files.length > 1 ? ` 等 ${String(detail.files.length)} 个文件` : ""}`
    case "file_read":
      return `读 ${detail.path}`
    case "fetch":
      return `取 ${detail.url}`
    default:
      return detail.name
  }
}

/** 展开之后有什么可看。没有就不给「展开」这个动作——**一个点了没反应的箭头比没有箭头糟**。 */
function bodyOf(detail: ToolDetail): string | undefined {
  if (detail.kind === "shell") return detail.output
  if (detail.kind === "file_edit") {
    const parts = detail.files.map((f) => `${f.kind} ${f.path}\n${f.diff ?? ""}`)
    return parts.join("\n\n") || undefined
  }
  if (detail.kind === "other") return detail.output === undefined ? undefined : JSON.stringify(detail.output, null, 2)
  return undefined
}

export function ToolRow({ item }: { item: ToolCallItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const body = bodyOf(item.detail)
  const title = titleOf(item.detail)

  return (
    <div className="item item--tool" data-status={item.status}>
      <button
        className="tool__head"
        type="button"
        disabled={body === undefined}
        aria-expanded={body === undefined ? undefined : open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className="tool__mark" aria-hidden="true">
          {STATUS_MARK[item.status]}
        </span>
        <code className="tool__title">{title}</code>
        {item.detail.kind === "file_edit" ? (
          <span className="tool__diffstat">
            +{item.detail.added} −{item.detail.removed}
          </span>
        ) : null}
      </button>
      {item.error === undefined ? null : <p className="tool__error">{item.error}</p>}
      {open && body !== undefined ? <pre className="tool__body">{body}</pre> : null}
    </div>
  )
}
