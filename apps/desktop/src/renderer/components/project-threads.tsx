import { useState } from "react"
import { pageOfThread, threadPage } from "../sidebar-page.js"
import type { Row } from "./SidebarRows.js"
import type { SidebarRow } from "../sidebar.js"

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
      {visible.pages > 1 ? (
        <div className="project-pages" role="group" aria-label="项目会话翻页">
          <button type="button" disabled={visible.page === 0} aria-label="上一页会话"
            onClick={() => setChoice({ selectedId, page: visible.page - 1 })}>上一页</button>
          <span aria-live="polite">{visible.start + 1}–{visible.end} / {rows.length}</span>
          <button type="button" disabled={visible.page + 1 === visible.pages} aria-label="下一页会话"
            onClick={() => setChoice({ selectedId, page: visible.page + 1 })}>下一页</button>
        </div>
      ) : null}
    </>
  )
}
