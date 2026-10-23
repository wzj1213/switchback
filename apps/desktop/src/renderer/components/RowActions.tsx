import { EllipsisIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { useMessages } from "../i18n.js"
import { ROW_ACTIONS } from "./RowActions.messages.js"

/**
 * 行尾那颗按钮：平时是「更多」，武装之后变成「确认」。
 *
 * **二次确认做在同一颗按钮上**而不是弹对话框：删一个会话不值得打断整个界面，
 * 但也不能点一下就没。照 codex 的 confirmArchiveTask。
 */
export function RowActions({
  confirming,
  onDelete,
  onDisarm,
  onMenu,
}: {
  confirming: boolean
  onDelete: () => void
  onDisarm: () => void
  onMenu: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const m = useMessages(ROW_ACTIONS)
  if (confirming) {
    return (
      <button
        type="button"
        className="row__act row__act--danger"
        aria-label={m.confirmLabel}
        data-tip={m.confirmTip}
        onClick={onDelete}
        onBlur={onDisarm}
      >
        {m.confirm}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="row__act"
      aria-label={m.more}
      data-tip={m.more}
      onClick={onMenu}
    >
      <EllipsisIcon size={SIDEBAR_ICON} />
    </button>
  )
}
