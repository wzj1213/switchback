import { useState } from "react"
import type { ApprovalItem, Command, RememberScope } from "@switchback/protocol"

/**
 * 审批卡。**这一端最要紧的一屏。**
 *
 * 一条设计规矩：**命令原文必须整条看得见、看得准**。等宽字体、**折行显示**、
 * 不截断——要被读准的正是那半截路径和那个参数。
 *
 * 折行而不是横滚，是出图之后改的：横滚意味着「屏幕外还有半条命令，
 * 你得先想到去划一下」，而这一屏的全部意义正是**你在按「允许」之前读全了它**。
 * 命令没有列要对齐，所以折行不损失任何东西；`pre` 留给真的有列的东西
 *（工具输出、diff）。样式在 `styles.css` 的 `.approval__cmd--block`。
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

const verdictOf = (item: ApprovalItem): string =>
  item.status === "allowed" ? "已允许" : item.status === "denied" ? "已拒绝" : "已失效"

export function Approval({
  item,
  send,
  offline,
  active,
}: {
  item: ApprovalItem
  send: (command: Command) => boolean
  /** 没连上时两颗按钮都禁掉。**点了没反应比点不了糟得多**——agent 那头在无超时地等。 */
  offline: boolean
  /**
   * 这张卡还有人在等。进程或那一轮已经不在了（历史会话、上次没收尾的卡），
   * 留着的 pending 只是一条历史：画成「已失效」，不摆两颗点了没反应的按钮。和桌面端同一个口径。
   */
  active: boolean
}): React.JSX.Element {
  const [scope, setScope] = useState<RememberScope>("once")

  if (item.status !== "pending" || !active) {
    return (
      <div className="item item--approval approval--done" data-status={item.status}>
        <span className="approval__verdict">{verdictOf(item)}</span>
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
          disabled={offline}
          onClick={() => {
            resolve(false)
          }}
        >
          拒绝
        </button>
        <button
          className="btn btn--primary"
          type="button"
          disabled={offline}
          onClick={() => {
            resolve(true)
          }}
        >
          允许
        </button>
      </div>
      {offline ? <p className="approval__offline">没连上 Switchback，先等重连——它那头还在等你。</p> : null}
    </div>
  )
}
