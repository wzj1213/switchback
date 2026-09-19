import { expect, it, vi } from "vitest"
import { dropEdge, rowDragProps } from "./sidebar-row-drag.js"
import { reorder } from "./sidebar.js"
import { rowDragOf, type ThreadDrag } from "./useThreadDrag.js"
import type { RowDrag } from "./components/SidebarRows.js"

it("行的前后都能插入，包括真正的末尾、自身和置顶回归", () => {
  for (const [from, to, edge, expected] of [
    ["a", "c", "after", ["b", "c", "a"]],
    ["c", "a", "before", ["c", "a", "b"]],
    ["b", "b", "after", ["a", "b", "c"]],
    ["b", "a", "after", ["a", "b", "c"]],
    ["pinned", "b", "after", ["a", "b", "pinned", "c"]],
  ] as const) expect(reorder(["a", "b", "c"], from, to, edge)).toEqual(expected)
  expect(dropEdge(117, { top: 100, height: 36 })).toBe("before")
  expect(dropEdge(118, { top: 100, height: 36 })).toBe("after")
})

it("同项目行消费悬停和落下事件，不能冒泡到置顶区", () => {
  const drag = { canDropOn: () => true, hoverRow: vi.fn(), drop: vi.fn() } as unknown as RowDrag
  const event = {
    preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: {}, clientY: 130,
    currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 36 }) },
  } as unknown as React.DragEvent<HTMLDivElement>
  const props = rowDragProps("target", "/project", false, drag)
  props.onDragOver?.(event)
  props.onDrop?.(event)
  expect(event.stopPropagation).toHaveBeenCalledTimes(2)
  expect(drag.hoverRow).toHaveBeenCalledWith("target", "after")
  expect(drag.drop).toHaveBeenCalledWith("target", "after")
})

it("分页排序仍保存整组；非法落点不能顺便取消置顶", () => {
  const ids = Array.from({ length: 503 }, (_, i) => String(i))
  const onReorder = vi.fn(), onPinThread = vi.fn()
  const drag = { item: { kind: "thread", id: "0", cwd: "/p", pinned: true }, end: vi.fn() } as unknown as ThreadDrag
  const rows = rowDragOf({ drag, groupOf: id => id === "19" ? { cwd: "/p", ids } : undefined,
    onReorder, onPinThread, reorder })
  rows.drop("missing", "after")
  expect(onPinThread).not.toHaveBeenCalled()
  rows.drop("19", "after")
  const saved = onReorder.mock.calls[0]?.[1] as string[]
  expect(saved).toHaveLength(503)
  expect(saved[19]).toBe("0")
  expect(saved[502]).toBe("502")
  expect(onPinThread).toHaveBeenCalledWith("0", false)
})
