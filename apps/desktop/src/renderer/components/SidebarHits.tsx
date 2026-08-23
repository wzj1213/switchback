import type { ThreadRow } from "@omni/store"
import type { EngineInfo } from "@omni/protocol"
import type { SidebarRow } from "../sidebar.js"
import { Row } from "./SidebarRows.js"
import type { RenameCtl } from "./RowName.js"

/**
 * 筛选命中的结果。**不分段**——命中的几条散在各组里，
 * 分组只会让人多点几下才看得见。
 *
 * 从 `Sidebar.tsx` 拆出来是行数闸门逼的，但边界清楚：
 * 那边是「平时怎么组织」，这边是「搜的时候怎么摆」。
 */
export function Hits({
  rows,
  total,
  selectedId,
  on,
}: {
  /** 带着未读旗子的那一份：搜出来的那一行照样该亮（见 `SidebarRow`）。 */
  rows: readonly SidebarRow[]
  total: number
  selectedId: string
  on: {
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    rowMenu: (event: React.MouseEvent, row: ThreadRow, arm: () => void, ren: () => void) => void
    rename: RenameCtl
    /** 引擎清单：行的悬停卡要把 engine id 翻成人话。 */
    engines: readonly EngineInfo[]
  }
}): React.JSX.Element {
  return (
    <>
      <div className="sidebar__section sidebar__section--static">
        命中 {rows.length} / {total}
      </div>
      {/* 空列表什么都不说的话，看起来像「会话全没了」 */}
      {rows.length === 0 ? <p className="sidebar__empty">没有匹配的会话。</p> : null}
      {rows.map((row) => (
        <Row
          key={row.thread.id}
          row={row}
          selected={row.thread.id === selectedId}
          flat
          engines={on.engines}
          rename={on.rename}
          onSelect={() => {
            on.onSelect(row.thread.id)
          }}
          onDelete={() => {
            on.onDelete(row.thread.id)
          }}
          onMenu={(e, arm, ren) => {
            on.rowMenu(e, row, arm, ren)
          }}
        />
      ))}
    </>
  )
}
