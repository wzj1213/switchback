import type { ThreadRow } from "@omni/store"
import type { Group } from "../sidebar.js"
import { ChevronIcon, FolderIcon, PlusIcon, SpinnerIcon } from "./icons.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { Row } from "./SidebarRows.js"
import type { RenameCtl } from "./RowName.js"

/*
 * 一个项目：标题行 + 它底下的会话。
 * 从 `SidebarRows.tsx` 拆出来是行数闸门逼的，边界也顺——
 * 那边是「一条会话怎么画」，这边是「一个项目怎么画」。
 */

export function GroupBlock({
  group,
  collapsed,
  selectedId,
  onToggle,
  onSelect,
  onDelete,
  onRowMenu,
  onGroupMenu,
  onNewIn,
  rename,
}: {
  group: Group
  collapsed: boolean
  selectedId: string
  onToggle: () => void
  onRowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void, ren: () => void) => void
  rename?: RenameCtl
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
  /** 在这个项目里新建会话。 */
  onNewIn: (cwd: string) => void
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
            <ChevronIcon open={!collapsed} size={SIDEBAR_ICON} />
          </span>
          <span className="row__lead">
            <FolderIcon size={SIDEBAR_ICON} />
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
        {/* **在这个项目里新建**——直达。原来只能走「右键 → 在此新建会话」，
            而右键是看不见的路 */}
        <button
          type="button"
          className="row__act"
          aria-label={`在 ${group.label} 新建会话`}
          title={`在 ${group.cwd} 新建会话`}
          onClick={() => {
            onNewIn(group.cwd)
          }}
        >
          <PlusIcon size={SIDEBAR_ICON} />
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
              rename={rename}
              onMenu={(e, arm, ren) => {
                onRowMenu(e, row, arm, ren)
              }}
            />
          ))}
    </div>
  )
}
