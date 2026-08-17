import { humanize } from "../../shared/failure.js"
import type { Notice } from "@omni/store"
import type { ThreadRow } from "@omni/store"

/**
 * 引擎出状况的横幅。
 *
 * 在这之前引擎起不来、崩了、进程泄漏，界面上**一律毫无反应**——
 * 用户只会看到「正在打开工作区…」一直转，或者一个点了没反应的界面。
 * 那不是缺功能，那是把故障吞掉了。
 *
 * 只显示**最新一条**：连着报五条同源的故障，把屏幕铺满并不会让人更容易看懂，
 * 只会让人更早地开始无视它。
 */
export function Notices({
  notices,
  rows,
  onDismiss,
  onSelect,
}: {
  notices: readonly Notice[]
  /** 全部会话。横幅要靠它把 `threadId` 翻成看得懂的名字。 */
  rows: readonly ThreadRow[]
  onDismiss: (id: string) => void
  /** 点横幅跳到出事的那条会话。 */
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  const latest = notices[notices.length - 1]
  if (latest === undefined) return null
  /**
   * **出事的是哪一条**。横幅画在当前会话的正文区里，而故障可能来自另一条——
   * 上一版不写名字也点不过去：B 崩了，红条挂在你正在看的 A 上面。
   */
  const source = rows.find((r) => r.thread.id === latest.threadId)?.thread
  return (
    <div className="notice" role="alert">
      {/* **抬头照实写。** 上一版一律写「引擎故障」，而「MCP 没起来」「没登录」
          这两种引擎好好的——顶着「故障」端出去，就是把排查引到错的方向 */}
      <span className={`notice__badge${latest.kind === "degraded" ? " notice__badge--soft" : ""}`}>
        {latest.kind === "degraded" ? "能力受限" : "引擎故障"}
      </span>
      {/* 横幅上只放人话那一句：这一条本来就是「扫一眼就走」的东西，
          真要看原文，同一段也会作为一条 error 落在对话里，那边能展开 */}
      <span className="notice__text" title={latest.text}>
        {humanize(latest.text).text}
      </span>
      {source === undefined ? null : (
        <button
          type="button"
          className="notice__go"
          title={`跳到「${source.title}」`}
          onClick={() => {
            onSelect(source.id)
          }}
        >
          {source.title}
        </button>
      )}
      <button
        className="notice__close"
        type="button"
        aria-label="关闭"
        onClick={() => {
          onDismiss(latest.id)
        }}
      >
        ×
      </button>
    </div>
  )
}
