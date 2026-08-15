import type { Notice } from "@omni/store"

/**
 * 引擎故障横幅。
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
  onDismiss,
}: {
  notices: readonly Notice[]
  onDismiss: (id: string) => void
}): React.JSX.Element | null {
  const latest = notices[notices.length - 1]
  if (latest === undefined) return null
  return (
    <div className="notice" role="alert">
      <span className="notice__badge">引擎故障</span>
      <span className="notice__text">{latest.text}</span>
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
