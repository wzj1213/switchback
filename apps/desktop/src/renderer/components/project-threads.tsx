import { useState } from "react"
import { pageOfThread, threadPage } from "../sidebar-page.js"
import type { Row } from "./SidebarRows.js"
import type { SidebarRow } from "../sidebar.js"
import { SidebarPages } from "./sidebar-pages.js"

/** 每个项目独立翻页；切换选中会话时同步定位，折叠不会清掉阅读页。 */
export function ProjectThreads({ rows, selectedId, collapsed, children }: {
  rows: readonly SidebarRow[]
  selectedId: string
  collapsed: boolean
  children: (row: SidebarRow) => React.ReactElement<React.ComponentProps<typeof Row>>
}): React.JSX.Element | null {
  const [choice, setChoice] = useState(() => ({ selectedId, page: pageOfThread(rows, selectedId) }))
  if (choice.selectedId !== selectedId) {
    setChoice({ selectedId, page: pageOfThread(rows, selectedId, choice.page) })
  }
  const visible = threadPage(rows, choice.page)
  if (collapsed) return null
  if (rows.length === 0) return <p className="sidebar__empty">还没有会话。点这一行右边的 + 开一条。</p>
  return (
    <>
      {visible.rows.map(children)}
      <SidebarPages {...visible} total={rows.length} label="会话"
        onPage={(page) => setChoice({ selectedId, page })} />
    </>
  )
}
