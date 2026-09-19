import { expect, it } from "vitest"
import { measureNavPoints, sameRailMarks } from "./transcript-geometry.js"
import type { RailMark } from "./transcript-rail.js"

it("一次扫描定位 240 问，保留滚动偏移并忽略缺失节点", () => {
  let scans = 0
  const points = Array.from({ length: 240 }, (_, i) => ({ id: String(i), text: "问题", weight: 1 }))
  const box = {
    scrollTop: 500,
    getBoundingClientRect: () => ({ top: 60 }),
    querySelectorAll: () => {
      scans++
      return points.map((point, i) => ({
        getAttribute: () => point.id,
        getBoundingClientRect: () => ({ top: 60 + i * 100 - 500 }),
      }))
    },
  } as unknown as HTMLElement
  const placed = measureNavPoints(box, [...points, { id: "missing", text: "", weight: 0 }])
  expect(scans).toBe(1)
  expect(placed).toHaveLength(240)
  expect(placed[239]?.top).toBe(23_900)
})

it("位置没变时仍更新大纲内容、字数与覆盖的提问", () => {
  const mark: RailMark = { id: "a", text: "标题", y: 20, width: 8, ids: ["a"] }
  expect(sameRailMarks([mark], [{ ...mark }])).toBe(true)
  for (const change of [{ text: "新标题" }, { width: 12 }, { engine: "kimi" }, { ids: ["a", "b"] }])
    expect(sameRailMarks([mark], [{ ...mark, ...change }])).toBe(false)
})
