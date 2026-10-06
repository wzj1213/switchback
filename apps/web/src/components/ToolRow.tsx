import { memo, useMemo, useState } from "react"
import type { ToolCallItem, ToolDetail } from "@switchback/protocol"

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
export function titleOf(detail: ToolDetail): string {
  switch (detail.kind) {
    case "shell":
      return detail.terminal?.waiting === true ? `等后台终端 · ${detail.command}` : detail.command
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

/**
 * 展开之后**有没有**东西可看。
 *
 * 和 `bodyOf` 分开是因为这一问每次渲染都要答（它决定那个箭头给不给按），
 * 而 `bodyOf` 对一次多文件编辑要把所有 diff 拼成一个字符串——
 * **折叠着也拼**。一条工具行不展开时，那份字符串没有任何人看。
 */
export function hasBody(detail: ToolDetail): boolean {
  if (detail.kind === "shell") {
    return detail.output !== undefined || (detail.terminal?.inputs.length ?? 0) > 0
  }
  if (detail.kind === "file_edit") return detail.files.length > 0
  if (detail.kind === "other") return detail.output !== undefined
  return false
}

/** 展开之后有什么可看。没有就不给「展开」这个动作——**一个点了没反应的箭头比没有箭头糟**。 */
export function bodyOf(detail: ToolDetail): string | undefined {
  if (detail.kind === "shell") return shellBody(detail)
  if (detail.kind === "file_edit") {
    const parts = detail.files.map((f) => `${f.kind} ${f.path}\n${f.diff ?? ""}`)
    return parts.join("\n\n") || undefined
  }
  if (detail.kind === "other" && detail.output !== undefined) {
    return typeof detail.output === "string" ? detail.output : JSON.stringify(detail.output, null, 2)
  }
  return undefined
}

function shellBody(detail: Extract<ToolDetail, { kind: "shell" }>): string | undefined {
  const inputs = detail.terminal?.inputs ?? []
  if (inputs.length === 0) return detail.output
  const sections = inputs.map((input, index) => `后台终端输入 ${String(index + 1)}：\n${input}`)
  if (detail.output !== undefined && detail.output !== "")
    sections.unshift(`终端输出：\n${detail.output}`)
  return sections.join("\n\n")
}

/**
 * **包了 `memo` 且正文按需算。** 工具行是手机上数量最多的一类 item，
 * 而它绝大多数时候是折叠的——上一版每一帧都把所有 diff 拼一遍字符串给
 * 一个没人看的折叠行。流式期间那是每秒六十次。
 */
export const ToolRow = memo(function ToolRow({ item }: { item: ToolCallItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const detail = item.detail
  const can = hasBody(detail)
  // **只有真的展开了才拼。** 折叠着的时候 `body` 是 undefined，而箭头给不给按
  // 由上面那个便宜的 `can` 决定
  const body = useMemo(() => (open ? bodyOf(detail) : undefined), [open, detail])
  const title = titleOf(item.detail)

  return (
    <div className="item item--tool" data-status={item.status}>
      <button
        className="tool__head"
        type="button"
        disabled={!can}
        aria-expanded={can ? open : undefined}
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
})
