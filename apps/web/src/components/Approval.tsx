import { useState } from "react"
import type { ApprovalItem, Command, RememberScope } from "@omni/protocol"

/**
 * 审批卡。**这一端最要紧的一屏。**
 *
 * 一条设计规矩：**命令原文必须看得见、看得准**。等宽字体、可横向滚动、
 * 不换行不截断——要被读准的正是那半截路径和那个参数。桌面端为此改过一次
 * （「审批卡上的命令原文改用等宽字体」），这里从一开始就照那条来。
 *
 * 记忆范围三档在手机上收成两档：**「就这次」和「本会话」**。
 * `project` 级规则会落盘、跨会话生效，那是在一块小屏幕上做一个长期决定——
 * 服务端也会把远程发来的 `project` 降成 `session`（见 `remote/policy.ts`），
 * 所以这里干脆不摆那个选项，而不是摆一个点了会被悄悄改掉的按钮。
 */

const SCOPES: readonly { id: RememberScope; label: string }[] = [
  { id: "once", label: "就这次" },
  { id: "session", label: "本会话都允许" },
]

export function Approval({
  item,
  send,
}: {
  item: ApprovalItem
  send: (command: Command) => void
}): React.JSX.Element {
  const [scope, setScope] = useState<RememberScope>("once")

  if (item.status !== "pending") {
    return (
      <div className="item item--approval approval--done" data-status={item.status}>
        <span className="approval__verdict">{item.status === "allowed" ? "已允许" : "已拒绝"}</span>
        <code className="approval__cmd">{item.summary}</code>
      </div>
    )
  }

  const resolve = (allow: boolean): void => {
    send({ type: "approval.resolve", itemId: item.id, allow, remember: allow ? scope : "once" })
  }

  return (
    <div className="item item--approval approval--pending" role="group" aria-label="需要你确认">
      <p className="approval__why">{item.reason}</p>
      <pre className="approval__cmd approval__cmd--block">{item.summary}</pre>
      <div className="approval__scopes" role="radiogroup" aria-label="记住这次决定的范围">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={scope === s.id}
            className="chip"
            data-on={scope === s.id}
            onClick={() => {
              setScope(s.id)
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="approval__acts">
        <button
          className="btn btn--deny"
          type="button"
          onClick={() => {
            resolve(false)
          }}
        >
          拒绝
        </button>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => {
            resolve(true)
          }}
        >
          允许
        </button>
      </div>
    </div>
  )
}
