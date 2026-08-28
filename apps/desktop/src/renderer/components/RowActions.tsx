import { EllipsisIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"

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
  if (confirming) {
    return (
      <button
        type="button"
        className="row__act row__act--danger"
        aria-label="确认删除"
        data-tip="再点一次就真的删了，不可撤销"
        onClick={onDelete}
        onBlur={onDisarm}
      >
        确认
      </button>
    )
  }
  return (
    <button
      type="button"
      className="row__act"
      aria-label="更多操作"
      data-tip="更多操作"
      onClick={onMenu}
    >
      <EllipsisIcon size={SIDEBAR_ICON} />
    </button>
  )
}
