import { useEffect } from "react"
import { CloseIcon } from "./icons-panel.js"
import { AlertIcon } from "./icons-activity.js"
import { humanize } from "../../shared/failure.js"
import type { Notice } from "@switchback/store"
import type { ThreadRow } from "@switchback/store"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { NOTICES } from "./Notices.messages.js"

type NoticeTone = "danger" | "warning" | "info"

function toneOf(notice: Notice): NoticeTone {
  if (notice.kind === "notification") {
    if (notice.color === "error") return "danger"
    return notice.priority === "high" || notice.priority === "immediate" ? "warning" : "info"
  }
  return notice.kind === "crashed" || notice.kind === "egress" ? "danger" : "warning"
}

/**
 * 横幅上摆哪一条。平时是最新那条；**有没关掉的「批量外发」就一直是它**：
 * Switchback 停掉一个正在往外传的引擎之后，驱动紧接着会报一条「进程退出了」——
 * 按最新摆的话，那条故障会把真正的原因盖掉。
 */
function shownOf(notices: readonly Notice[]): Notice | undefined {
  return notices.findLast((notice) => notice.kind === "egress") ?? notices[notices.length - 1]
}

function labelOf(notice: Notice, m: (typeof NOTICES)[Locale]): string {
  if (notice.kind === "crashed") return m.crashed
  if (notice.kind === "degraded") return m.degraded
  if (notice.kind === "auth") return m.auth
  if (notice.kind === "egress") return m.egress
  return m.notice
}

/**
 * 引擎故障与原生瞬时通知共用的横幅。
 *
 * 在这之前引擎起不来、崩了、进程泄漏，界面上**一律毫无反应**——
 * 用户只会看到「正在打开工作区…」一直转，或者一个点了没反应的界面。
 * 那不是缺功能，那是把故障吞掉了。
 *
 * 只显示**最新一条**：连着报五条同源的故障，把屏幕铺满并不会让人更容易看懂，
 * 只会让人更早地开始无视它。同一件事接连报的在 store 里就合成了一条（`count`）。
 */
export function Notices({
  notices,
  rows,
  onDismiss,
  onSelect,
  onLogin,
}: {
  notices: readonly Notice[]
  /** 全部会话。横幅要靠它把 `threadId` 翻成看得懂的名字。 */
  rows: readonly ThreadRow[]
  onDismiss: (id: string) => void
  /** 点横幅跳到出事的那条会话。 */
  onSelect: (id: string) => void
  /** 「需要登录」那一类直接给一条去登录的路（设置 → 安装与接入）。 */
  onLogin?: () => void
}): React.JSX.Element | null {
  const m = useMessages(NOTICES)
  const latest = shownOf(notices)
  useEffect(() => {
    if (latest?.kind !== "notification" || latest.timeoutMs === undefined) return
    // 以本端收到事件的时刻起算；远程设备与宿主的系统时钟不一定一致。
    const timer = setTimeout(onDismiss, latest.timeoutMs, latest.id)
    return () => clearTimeout(timer)
  }, [latest, onDismiss])
  if (latest === undefined) return null
  /**
   * **出事的是哪一条**。横幅浮在当前会话的正文上，而故障可能来自另一条——
   * 上一版不写名字也点不过去：B 崩了，红条挂在你正在看的 A 上面。
   */
  const source = rows.find((r) => r.thread.id === latest.threadId)?.thread
  const tone = toneOf(latest)
  const text = latest.kind === "notification" ? latest.text : humanize(latest.text).text
  return (
    // **零高度的锚**：卡浮在正文上面，出现和消失都不把对话往下推——
    // 上一版是一整条插进版面里的色带，每弹一次整屏跳一下，弹得越勤越烦
    <div className="notices">
      <div key={latest.id} className={`notice notice--${tone}`} role={tone === "info" ? "status" : "alert"}>
        <span className="notice__icon" aria-hidden="true">
          <AlertIcon size={14} />
        </span>
        <div className="notice__body">
          <div className="notice__head">
            {/* **抬头照实写。** 上一版一律写「引擎故障」，而「MCP 没起来」「没登录」
                这两种引擎好好的——顶着「故障」端出去，就是把排查引到错的方向 */}
            <span className="notice__badge">{labelOf(latest, m)}</span>
            {/* 同一件事接连报了几次：合成一条、记个数，不是再弹一张一模一样的 */}
            {(latest.count ?? 1) > 1 ? <span className="notice__count">{`×${String(latest.count)}`}</span> : null}
            {source === undefined ? null : (
              <button type="button" className="notice__go" title={m.goTo(source.title)} onClick={() => { onSelect(source.id) }}>
                {source.title}
              </button>
            )}
          </div>
          {/* 只放人话那一句、最多三行：真要看原文，同一段也会作为一条报错落在对话里，那边能展开 */}
          <p className="notice__text" title={latest.text}>{text}</p>
        </div>
        {latest.kind === "auth" && onLogin !== undefined ? (
          <button type="button" className="btn btn--slim notice__act" title={m.loginTip} onClick={onLogin}>
            {m.login}
          </button>
        ) : null}
        <button className="notice__close" type="button" aria-label={m.close} onClick={() => { onDismiss(latest.id) }}>
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  )
}
