import { useState } from "react"
import { Markdown } from "./Markdown.js"
import type { ApprovalItem, Item, ItemId, ToolCallItem } from "@omni/protocol"

/** 用户对一张审批卡的裁决。remember 为真表示勾了「本项目不再询问」。 */
export type ResolveApproval = (itemId: ItemId, allow: boolean, remember: boolean) => void

/**
 * 审批卡。**整个产品最关键的界面**——上一版把它放在另一个页面（班组台），
 * 于是每个 Bash 都要跳出去批一次。这里它就在 transcript 里，原地处理。
 */
function Approval({
  item,
  onResolve,
}: {
  item: ApprovalItem
  onResolve: ResolveApproval
}): React.JSX.Element {
  const [remember, setRemember] = useState(false)
  const settled = item.status !== "pending"
  return (
    <div className="approval">
      <div className="approval__title">需要确认：{item.summary}</div>
      <div className="approval__reason">{item.reason}</div>
      <div className="approval__actions">
        <button
          className="btn btn--primary"
          type="button"
          disabled={settled}
          onClick={() => {
            onResolve(item.id, true, remember)
          }}
        >
          {item.status === "allowed" ? "已允许" : "允许"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={settled}
          onClick={() => {
            onResolve(item.id, false, false)
          }}
        >
          {item.status === "denied" ? "已拒绝" : "拒绝"}
        </button>
        <label className="approval__remember">
          <input
            type="checkbox"
            checked={remember}
            disabled={settled}
            onChange={(e) => {
              setRemember(e.target.checked)
            }}
          />{" "}
          {item.rememberHint ?? "本项目不再询问"}
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
