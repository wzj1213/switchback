import { useLayoutEffect, useRef, useState } from "react"
import { PROJECT_MAX, type Sections, type SidebarRow } from "./sidebar.js"

export interface ProjectPageChoice { selectedId: string; page: number }

/** 只保留当前窗口的浏览位置；列表卸载时不丢状态，也不保留隐藏的会话 DOM。 */
export interface SidebarNavigation {
  sections: ReadonlySet<string>
  allProjects: boolean
  pages: Map<string, ProjectPageChoice>
  scrollTop: number
  selectedId: string
  picked: boolean
}

export function revealSidebarResult(view: SidebarNavigation, sections: Sections, row: SidebarRow): void {
  const pinned = sections.pinnedThreads.some(item => item.thread.id === row.thread.id) ||
    sections.pinned.some(group => group.rows.some(item => item.thread.id === row.thread.id))
  const section = pinned ? "pin" : row.thread.workspaceKind === "chat" ? "chat" : "proj"
  view.sections = new Set([...view.sections].filter(key => key !== section))
  view.allProjects ||= sections.projects.findIndex(group => group.cwd === row.thread.cwd) >= PROJECT_MAX
  view.pages.delete(row.thread.cwd)
  view.picked = true
}

export function useSidebarNavigation(selectedId: string): {
  view: SidebarNavigation
  list: React.RefObject<HTMLDivElement | null>
  query: string
  onQuery: (query: string) => void
} {
  const [view] = useState<SidebarNavigation>(() => ({
    sections: new Set(), allProjects: false, pages: new Map(), scrollTop: 0, selectedId, picked: false,
  }))
  const [query, setQuery] = useState("")
  const list = useRef<HTMLDivElement>(null)
  const wasFiltering = useRef(false)
  const filtering = query.trim() !== ""
  useLayoutEffect(() => {
    if (wasFiltering.current && !filtering && list.current !== null) {
      if (view.picked || view.selectedId !== selectedId)
        list.current.querySelector(".row--selected")?.scrollIntoView({ block: "nearest", behavior: "instant" })
      else list.current.scrollTop = view.scrollTop
    }
    wasFiltering.current = filtering
  }, [filtering, selectedId, view])
  return {
    view, list, query,
    onQuery: (next) => {
      if (!filtering && next.trim() !== "") {
        view.scrollTop = list.current?.scrollTop ?? 0
        view.selectedId = selectedId
        view.picked = false
      }
      setQuery(next)
    },
  }
}
