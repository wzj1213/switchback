import { expect, it } from "vitest"
import type { SidebarRow } from "./sidebar.js"
import { pageOfThread, threadPage } from "./sidebar-page.js"

const rows = Array.from({ length: 503 }, (_, i) => ({ thread: { id: String(i) } })) as SidebarRow[]

it("大项目按需取页，末页删除后回退到有效范围", () => {
  for (const [page, first, count] of [[0, "0", 20], [1, "20", 20], [25, "500", 3], [99, "500", 3]] as const) {
    const view = threadPage(rows, page)
    expect(view.rows[0]?.thread.id).toBe(first)
    expect(view.rows).toHaveLength(count)
  }
  expect(threadPage(rows.slice(0, 500), 25).page).toBe(24)
  expect(threadPage([], 10)).toMatchObject({ rows: [], page: 0, pages: 1, start: 0, end: 0 })
})

it("搜索选中旧会话时定位所属页，别的项目选择不重置当前页", () => {
  expect(pageOfThread(rows, "480")).toBe(24)
  expect(pageOfThread(rows, "20")).toBe(1)
  expect(pageOfThread(rows, "elsewhere", 4)).toBe(4)
  expect(rows).toHaveLength(503)
})
