import type { ApprovalItem, Item, ToolCallItem, ToolDetail } from "@omni/protocol"

const TOOL_LABEL: Record<ToolDetail["kind"], string> = {
  shell: "执行",
  file_edit: "编辑",
  file_read: "读取",
  fetch: "请求",
  other: "调用",
}

function toolTarget(detail: ToolDetail): string {
  switch (detail.kind) {
    case "shell":
      return detail.command
    case "file_edit":
    case "file_read":
      return detail.path
    case "fetch":
      return detail.url
    case "other":
      return detail.name
  }
}

function toolBody(detail: ToolDetail): string | undefined {
  if (detail.kind === "shell") return detail.output
  if (detail.kind === "file_edit") return detail.diff
  return undefined
}

function ToolCall({ item }: { item: ToolCallItem }): React.JSX.Element {
  const body = toolBody(item.detail)
  const edit = item.detail.kind === "file_edit" ? item.detail : undefined
  return (
    <div className="tool">
      <div className="tool__head">
        <span className="tool__kind">{TOOL_LABEL[item.detail.kind]}</span>
        <span className="tool__target">{toolTarget(item.detail)}</span>
        {edit !== undefined ? (
          <span className="diffstat">
            <span className="diffstat__add">+{edit.added}</span>{" "}
            <span className="diffstat__del">−{edit.removed}</span>
          </span>
        ) : (
          <span className={`tool__status tool__status--${item.status}`}>{item.status}</span>
        )}
      </div>
      {body !== undefined ? <div className="tool__body">{body}</div> : null}
    </div>
  )
}

/**
 * 审批卡。**整个产品最关键的界面**——上一版把它放在另一个页面（班组台），
 * 于是每个 Bash 都要跳出去批一次。这里它就在 transcript 里，原地处理。
 */
function Approval({ item }: { item: ApprovalItem }): React.JSX.Element {
  return (
    <div className="approval">
      <div className="approval__title">需要确认：{item.summary}</div>
      <div className="approval__reason">{item.reason}</div>
      <div className="approval__actions">
        <button className="btn btn--primary" type="button">
          允许
        </button>
        <button className="btn" type="button">
          拒绝
        </button>
        <label className="approval__remember">
          <input type="checkbox" /> 本项目不再询问
        </label>
      </div>
    </div>
  )
}

function Plan({ steps }: { steps: readonly { text: string; status: string }[] }): React.JSX.Element {
  const mark: Record<string, string> = {
    done: "✓",
    in_progress: "→",
    pending: "·",
    dropped: "×",
  }
  return (
    <div className="tool">
      <div className="tool__head">
        <span className="tool__kind">计划</span>
      </div>
      <div className="tool__body">
        {steps.map((s) => `${mark[s.status] ?? "·"} ${s.text}`).join("\n")}
      </div>
    </div>
  )
}

export function ItemView({ item }: { item: Item }): React.JSX.Element | null {
  switch (item.kind) {
    case "user_message":
      return <div className="msg--user">{item.text}</div>
    case "agent_message":
      return (
        <div className={`msg--agent${item.complete ? "" : " caret"}`}>{item.text}</div>
      )
    case "reasoning":
      return <div className="reasoning">{item.text}</div>
    case "tool_call":
      return <ToolCall item={item} />
    case "plan":
      return <Plan steps={item.steps} />
    case "approval":
      return <Approval item={item} />
    case "error":
      return <div className="error">{item.message}</div>
  }
}
