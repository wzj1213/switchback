import type { ApprovalItem, ApprovalOrigin, Command, PendingApproval } from "@switchback/protocol"
import { Approval } from "./Approval.js"

/** 谁要的：只写引擎报的 id，不猜名字；没报就照实说。和桌面端同一个口径。 */
function originText(origin: ApprovalOrigin | undefined): string {
  if (origin === undefined) return "后台来的请求 · 来源未标明"
  return `${origin.kind === "task" ? "后台任务" : "子 agent"} · ${origin.label ?? origin.id}`
}

function waitedText(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return "刚刚"
  return minutes < 60 ? `已等 ${String(minutes)} 分钟` : `已等 ${String(Math.floor(minutes / 60))} 小时`
}

/** 借审批卡的样子画：它不在任何一轮里，`turnId` 留空。 */
function asItem(one: PendingApproval): ApprovalItem {
  return {
    id: one.id, turnId: "", kind: "approval", at: one.at, toolCallId: "", tool: one.tool,
    summary: one.summary, status: "pending", reason: one.reason,
    ...(one.rememberHint === undefined ? {} : { rememberHint: one.rememberHint }),
    ...(one.origin === undefined ? {} : { origin: one.origin }),
  }
}

/**
 * 主轮之外来的权限请求（后台子 agent、workflow 在主轮收工之后才来要的）。
 *
 * 不在转录区里——没有轮次可挂——列在输入框上方，和后台问题同一处。不设超时，写已经等了多久。
 * 这一端的用途本来就是「它卡住了，我去放行」，所以照样能批；红线那种只给「就这次」。
 */
export function OutsideApprovals({ approvals, send, offline, now }: {
  approvals: readonly PendingApproval[] | undefined
  send: (command: Command) => boolean
  offline: boolean
  now: number
}): React.JSX.Element | null {
  if (approvals === undefined || approvals.length === 0) return null
  return (
    <div className="outside-approvals" aria-label="后台在等你确认">
      {approvals.map((one) => (
        <Approval
          key={one.id}
          item={asItem(one)}
          send={send}
          offline={offline}
          active
          note={`${originText(one.origin)} · ${waitedText(one.at, now)}`}
          rememberable={one.redline !== true}
        />
      ))}
    </div>
  )
}
