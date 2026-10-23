import { useLayoutEffect, useState } from "react"
import { pageOfThread, threadPage } from "../sidebar-page.js"
import type { Row } from "./SidebarRows.js"
import type { SidebarRow } from "../sidebar.js"
import { SidebarPages } from "./sidebar-pages.js"
import type { SidebarNavigation } from "../use-sidebar-navigation.js"
import { useMessages } from "../i18n.js"
import { PROJECT_THREADS } from "./project-threads.messages.js"

/** 每个项目独立翻页；切换选中会话时同步定位，折叠不会清掉阅读页。 */
export function ProjectThreads({ rows, selectedId, collapsed, children, pages, cwd }: {
  pages: SidebarNavigation["pages"]
  cwd: string
  rows: readonly SidebarRow[]
  selectedId: string
  collapsed: boolean
  children: (row: SidebarRow) => React.ReactElement<React.ComponentProps<typeof Row>>
}): React.JSX.Element | null {
  const m = useMessages(PROJECT_THREADS)
  const [choice, setChoice] = useState(() => pages.get(cwd) ?? { selectedId, page: pageOfThread(rows, selectedId) })
  if (choice.selectedId !== selectedId) {
    setChoice({ selectedId, page: pageOfThread(rows, selectedId, choice.page) })
  }
  const visible = threadPage(rows, choice.page)
  useLayoutEffect(() => { pages.set(cwd, { selectedId, page: visible.page }) }, [pages, cwd, selectedId, visible.page])
  if (collapsed) return null
  if (rows.length === 0) return <p className="sidebar__empty">{m.empty}</p>
  return (
    <>
      {visible.rows.map(children)}
      <SidebarPages {...visible} total={rows.length} label={m.threads}
        onPage={(page) => setChoice({ selectedId, page })} />
    </>
  )
}
