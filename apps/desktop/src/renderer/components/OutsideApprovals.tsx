import type { ApprovalOrigin, Command, PendingApproval, RememberScope } from "@switchback/protocol"
import { ShieldIcon } from "./icons.js"
import type { Locale } from "@switchback/i18n"
import { useLocale } from "../i18n.js"
import { OUTSIDE_APPROVALS } from "./OutsideApprovals.messages.js"

/** 卡上写「谁要的」。只写引擎报的 id，不去对旁路猜名字；引擎没报就照实说。 */
export function originText(origin: ApprovalOrigin | undefined, locale: Locale): string {
  const m = OUTSIDE_APPROVALS[locale]
  if (origin === undefined) return m.unknownOrigin
  const who = origin.kind === "task" ? m.task : m.subagent
  return `${who} · ${origin.label ?? origin.id}`
}

/** 已经等了多久。不设超时，只说实话。 */
export function waitedText(at: number, now: number, locale: Locale): string {
  const m = OUTSIDE_APPROVALS[locale]
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return m.justNow
  if (minutes < 60) return m.waitedMinutes(minutes)
  return m.waitedHours(Math.floor(minutes / 60))
}

/**
 * 主轮之外来的权限请求：后台子 agent、workflow 在主轮收工之后才来要权限。
 *
 * 挂在输入框上方（和后台问题同一处），不进转录区——没有轮次可挂。和转录区里的审批卡比：
 *
 * - **不绑快捷键**：转录区里那张最新的卡才认 ⌘⏎ / ⌘⌫，两处都认就分不清批的是哪张。
 * - **没有「本轮剩下的都放行」**：这张卡不属于任何一轮。
 * - **红线不给「记住」**：撞上红线的那种只能逐次批。
 * - 子 agent 来的那张上，「允许此对话」写明主对话也算——它记的是整条会话的规则。
 */
export function OutsideApprovals({ approvals, send, now }: {
  approvals: readonly PendingApproval[]
  send: (command: Command) => void
  now: number
}): React.JSX.Element | null {
  const locale = useLocale()
  const m = OUTSIDE_APPROVALS[locale]
  if (approvals.length === 0) return null
  const decide = (itemId: string, allow: boolean, remember: RememberScope): void => {
    send({ type: "approval.resolve", itemId, allow, remember })
  }
  return (
    <div className="outside-approvals" aria-label={m.label}>
      {approvals.map((one) => (
        <div key={one.id} className="approval" role="group" aria-label={m.confirmLabel(one.summary)}>
          <div className="approval__body">
            <div className="approval__head">
              <span className="approval__mark" aria-hidden="true">
                <ShieldIcon size={13} />
              </span>
              {m.confirm}
              <span className="approval__origin">{originText(one.origin, locale)} · {waitedText(one.at, now, locale)}</span>
            </div>
            <code className="approval__cmd">{one.summary}</code>
            <div className="approval__reason">{one.reason}</div>
          </div>
          <div className="approval__actions">
            {one.redline === true || one.rememberHint === undefined ? null : (
              <button className="btn approval__always" type="button" title={m.alwaysTip(one.rememberHint)}
                onClick={() => { decide(one.id, true, "project") }}>
                {m.always}
              </button>
            )}
            {one.redline === true ? null : (
              <button className="btn" type="button" onClick={() => { decide(one.id, true, "session") }}>
                {one.origin === undefined ? m.allowSession : m.allowSessionMain}
              </button>
            )}
            <button className="btn" type="button" onClick={() => { decide(one.id, false, "once") }}>{m.deny}</button>
            <button className="btn btn--primary" type="button" onClick={() => { decide(one.id, true, "once") }}>
              {m.once}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
