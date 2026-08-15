import { useState } from "react"
import type { ThreadRow } from "@omni/store"
import { PROJECT_MAX, baseNameOf, type Group, type Sections } from "../sidebar.js"
import { ChevronIcon } from "./icons.js"
import { GroupBlock, Row } from "./SidebarRows.js"
import type { RenameCtl } from "./RowName.js"

/**
 * 侧栏的三段：置顶 / 项目 / 最近。
 *
 * 分段本身就是说明：置顶排在最前而不单独成段的话，它和普通项目长得一样，
 * 用户看不出「这几个是我钉住的」，也就想不起来还能取消。
 */

/** 分节标题。`›` 表示整段可折叠——codex 的三段也都是可折叠的。 */
export function SectionHead({
  title,
  open,
  onToggle,
  extra,
}: {
  title: string
  open: boolean
  onToggle: () => void
  extra?: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" className="sidebar__section" onClick={onToggle}>
      <span>{title}</span>
      <ChevronIcon open={open} size={11} />
      {extra}
    </button>
  )
}

export interface GroupHandlers {
  selectedId: string
  /** 这个项目现在是展开的吗。默认全折叠，见 `Sidebar.tsx`。 */
  isOpen: (cwd: string) => boolean
  onToggle: (cwd: string) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void, ren: () => void) => void
  rename?: RenameCtl
  onGroupMenu: (event: React.MouseEvent, group: Group) => void
}

function Groups({ groups, on }: { groups: readonly Group[]; on: GroupHandlers }): React.JSX.Element {
  return (
    <>
      {groups.map((group) => (
        <GroupBlock
          key={group.cwd}
          group={group}
          collapsed={!on.isOpen(group.cwd)}
          selectedId={on.selectedId}
          onToggle={() => {
            on.onToggle(group.cwd)
          }}
          onSelect={on.onSelect}
          onDelete={on.onDelete}
          onRowMenu={on.onRowMenu}
          rename={on.rename}
          onGroupMenu={on.onGroupMenu}
        />
      ))}
    </>
  )
}

/**
 * 项目段。超过 `PROJECT_MAX` 就折起来，留一行「展开显示」。
 *
 * 不做无限滚动也不做分页：项目数量是几十的量级，
 * 一行「展开显示」就够，多一套机制只会多一处出错的地方。
 */
function Projects({ groups, on }: { groups: readonly Group[]; on: GroupHandlers }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? groups : groups.slice(0, PROJECT_MAX)
  return (
    <>
      <Groups groups={shown} on={on} />
      {groups.length <= PROJECT_MAX ? null : (
        <button
          type="button"
          className="sidebar__more"
          onClick={() => {
            setAll((was) => !was)
          }}
        >
          {all ? "收起" : `展开显示（还有 ${String(groups.length - PROJECT_MAX)} 个）`}
        </button>
      )}
    </>
  )
}

/**
 * 最近段。
 *
 * 每行右边挂一个项目名——**这一段是跨项目的，不写就分不清
 * 「读一下 notes.txt」是哪个项目里的那件事**。
 */
function Recent({ rows, on }: { rows: readonly ThreadRow[]; on: GroupHandlers }): React.JSX.Element {
  return (
    <>
      {rows.map((row) => (
        <Row
          key={`recent-${row.thread.id}`}
          row={row}
          selected={row.thread.id === on.selectedId}
          flat
          aside={baseNameOf(row.thread.cwd)}
          onSelect={() => {
            on.onSelect(row.thread.id)
          }}
          onDelete={() => {
            on.onDelete(row.thread.id)
          }}
          rename={on.rename}
          onMenu={(e, arm, ren) => {
            on.onRowMenu(e, row, arm, ren)
          }}
        />
      ))}
    </>
  )
}

export function SectionList({ sections, on }: { sections: Sections; on: GroupHandlers }): React.JSX.Element {
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string): void => {
    setShut((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const open = (key: string): boolean => !shut.has(key)

  return (
    <>
      {sections.pinned.length === 0 ? null : (
        <>
          <SectionHead title="置顶" open={open("pin")} onToggle={() => { toggle("pin") }} />
          {open("pin") ? <Groups groups={sections.pinned} on={on} /> : null}
        </>
      )}

      <SectionHead title="项目" open={open("proj")} onToggle={() => { toggle("proj") }} />
      {open("proj") ? <Projects groups={sections.projects} on={on} /> : null}

      {sections.recent.length === 0 ? null : (
        <>
          <SectionHead title="最近" open={open("recent")} onToggle={() => { toggle("recent") }} />
          {open("recent") ? <Recent rows={sections.recent} on={on} /> : null}
        </>
      )}
    </>
  )
}
