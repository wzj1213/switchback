import type { SidebarRow } from "./sidebar.js"

export const THREAD_PAGE_SIZE = 20

export function pageOfThread(rows: readonly SidebarRow[], id: string, fallback = 0): number {
  const index = rows.findIndex((row) => row.thread.id === id)
  return index < 0 ? fallback : Math.floor(index / THREAD_PAGE_SIZE)
}

/** 只切渲染窗口，不截断搜索、计数或拖动排序使用的完整列表。 */
export function threadPage(rows: readonly SidebarRow[], wanted: number): {
  rows: readonly SidebarRow[]; page: number; pages: number; start: number; end: number
} {
  const pages = Math.max(1, Math.ceil(rows.length / THREAD_PAGE_SIZE))
  const page = Math.max(0, Math.min(wanted, pages - 1))
  const start = page * THREAD_PAGE_SIZE
  return { rows: rows.slice(start, start + THREAD_PAGE_SIZE), page, pages, start, end: Math.min(start + THREAD_PAGE_SIZE, rows.length) }
}
