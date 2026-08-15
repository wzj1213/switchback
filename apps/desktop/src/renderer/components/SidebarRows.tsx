import { useEffect, useState } from "react"
import type { ThreadStatus } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { rowLabelOf, type Group } from "../sidebar.js"
import { ChevronIcon, FolderIcon, SpinnerIcon } from "./icons.js"

/**
 * 侧栏里的行。
 *
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但边界是对的：
 * 那边管「侧栏由哪几块组成」，这边管「一行长什么样」。
 * 两边共用 `app.css` 里那套 `.row` —— 对齐靠的是它，不是各自的 padding。
 */

const DOT_CLASS: Record<ThreadStatus, string> = {
  // 起引擎那几百毫秒：和「跑着」用同一个呼吸动画，因为**对用户来说就是同一件事**
  //（有东西在动、还不能输入），没必要为它发明第三种视觉语言
  starting: " row__dot--running",
  idle: "",
  running: " row__dot--running",
  waiting_approval: " row__dot--waiting",
  failed: " row__dot--failed",
}

/** 光靠颜色说不清「要你去做什么」，等待批准这一档补一句字。 */
const NOTE: Partial<Record<ThreadStatus, string>> = { waiting_approval: "待批", starting: "启动中" }

export function Row({
  row,
  selected,
  flat = false,
  aside,
  onSelect,
  onDelete,
  onMenu,
}: {
  row: ThreadRow
  selected: boolean
  /** 不在项目组里（筛选结果、最近段）：不缩进那一级。 */
  flat?: boolean
  /** 右侧的一小段附注。「最近」段用它写项目名——那一段是跨项目的。 */
  aside?: string
  onSelect: () => void
  onDelete: () => void
  /** 右键或点 `···`。`arm` 让菜单能把这一行切进删除确认态。 */
  onMenu: (event: React.MouseEvent, arm: () => void) => void
}): React.JSX.Element {
  const { thread } = row
  // 二次确认做在**同一个按钮**上而不是弹一个对话框：删一个会话不值得打断整个界面，
  // 但也不能点一下就没。照 codex 的 confirmArchiveTask。
  const [confirming, setConfirming] = useState(false)
  const arm = (): void => {
    setConfirming(true)
  }
  /**
   * **武装状态要自己解除。**
   *
   * 上一版只靠确认按钮的 `onBlur`，而从右键菜单武装时那个按钮根本没拿到过焦点，
   * 于是 blur 永远不来——那一行就一直挂着「确认」，**下一次点它直接把会话删了**，
   * 而用户以为自己点的是「更多操作」。删除不可撤销，不能有这种残留。
   */
  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => {
      setConfirming(false)
    }, 4000)
    return () => {
      clearTimeout(timer)
    }
  }, [confirming])
  return (
    <div
      className={`row row--thread${flat ? " row--flat" : ""}${selected ? " row--selected" : ""}`}
      title={thread.cwd}
      onContextMenu={(e) => {
        onMenu(e, arm)
      }}
    >
      <button type="button" className="row__main" aria-selected={selected} onClick={onSelect}>
        <span className="row__slot">
          <span className={`row__dot${DOT_CLASS[thread.status]}`} />
        </span>
        <span className="row__label">{rowLabelOf(row)}</span>
        {aside === undefined ? null : <span className="row__aside">{aside}</span>}
        {/* 跑着的时候右侧转一个圈。**这是唯一能在不切会话的情况下看出「那边还在忙」
            的地方**——状态点太小、又和「有未读」这类含义抢同一个位置 */}
        {thread.status === "running" ? (
          <span className="row__spin" aria-label="正在运行">
            <SpinnerIcon />
          </span>
        ) : null}
        {NOTE[thread.status] === undefined ? null : <span className="row__note">{NOTE[thread.status]}</span>}
      </button>
      {confirming ? (
        <button
          type="button"
          className="row__act row__act--danger"
          aria-label="确认删除"
          title="再点一次就真的删了，不可撤销"
          onClick={onDelete}
          onBlur={() => {
            setConfirming(false)
          }}
        >
          确认
        </button>
      ) : (
        <button
          type="button"
          className="row__act"
          aria-label="更多操作"
          title="更多操作"
          onClick={(e) => {
            onMenu(e, arm)
          }}
        >
          ···
        </button>
      )}
    </div>
  )
}

export function GroupBlock({
  group,
  collapsed,
  selectedId,
  onToggle,
  onSelect,
  onDelete,
  onRowMenu,
  onGroupMenu,
}: {
  group: Group
  collapsed: boolean
  selectedId: string
  onToggle: () => void
  onRowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void) => void
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const running = group.rows.filter((r) => r.thread.status === "running").length
  return (
    <div className="group">
      <div
        className="row row--group"
        title={group.cwd}
        onContextMenu={(e) => {
          onGroupMenu(e, group)
        }}
      >
        <button type="button" className="row__main" onClick={onToggle}>
          <span className="row__slot">
            <ChevronIcon open={!collapsed} />
          </span>
          <span className="row__lead">
            <FolderIcon />
          </span>
          <span className="row__label">{group.label}</span>
          {/* 折起来的时候，「这个项目里有没有东西在跑」只剩这一个出口。
              展开时每行自己会转圈，这里就不重复了 */}
          {collapsed && running > 0 ? (
            <span className="row__spin" aria-label={`${String(running)} 个在跑`}>
              <SpinnerIcon />
            </span>
          ) : null}
          <span className="row__count">{group.rows.length}</span>
        </button>
        {/* 项目这一行也给一个 `···`。右键菜单一直都有，但**看不见的功能等于没有**——
            没人会去右键一个看起来只是分组标题的东西 */}
        <button
          type="button"
          className="row__act"
          aria-label="项目操作"
          title="项目操作"
          onClick={(e) => {
            onGroupMenu(e, group)
          }}
        >
          ···
        </button>
      </div>
      {collapsed
        ? null
        : group.rows.map((row) => (
            <Row
              key={row.thread.id}
              row={row}
              selected={row.thread.id === selectedId}
              onSelect={() => {
                onSelect(row.thread.id)
              }}
              onDelete={() => {
                onDelete(row.thread.id)
              }}
              onMenu={(e, arm) => {
                onRowMenu(e, row, arm)
              }}
            />
          ))}
    </div>
  )
}

