import { Markdown } from "./Markdown.js"
import { Approval, type ResolveApproval } from "./Approval.js"
import type { Item, ToolCallItem } from "@omni/protocol"

function Plan({ steps }: { steps: readonly { text: string; status: string }[] }): React.JSX.Element {
  const mark: Record<string, string> = {
    done: "✓",
    in_progress: "→",
    pending: "·",
    dropped: "×",
  }
  return (
    <div className="run">
      <div className="step">
        <span className="step__verb">计划</span>
      </div>
      <pre className="step__out">
        {steps.map((s) => `${mark[s.status] ?? "·"} ${s.text}`).join("\n")}
      </pre>
    </div>
  )
}

/**
 * 除工具调用之外的 item。工具调用由 `ToolRun` 成组渲染——
 * 这里把它从类型上排除掉，switch 才能保持穷尽，漏一种就编译不过。
 */
export function ItemView({
  item,
  onResolve,
}: {
  item: Exclude<Item, ToolCallItem>
  onResolve: ResolveApproval
}): React.JSX.Element {
  switch (item.kind) {
    case "user_message":
      return <div className="msg--user">{item.text}</div>
    // 用户消息保持字面量：他打的是什么就显示什么，替他解析 Markdown 是意外行为
    case "agent_message":
      return (
        <div className={`msg--agent${item.complete ? "" : " caret"}`}>
          <Markdown text={item.text} />
        </div>
      )
    case "reasoning":
      return (
        <div className="reasoning">
          <Markdown text={item.text} />
        </div>
      )
    case "plan":
      return <Plan steps={item.steps} />
    case "approval":
      return <Approval item={item} onResolve={onResolve} />
    case "error":
      return <div className="error">{item.message}</div>
  }
}
