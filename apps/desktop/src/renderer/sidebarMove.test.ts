import { describe, expect, it } from "vitest"
import { canShift, shifted } from "./sidebarMove.js"

describe("键盘排序", () => {
  const cases = [
    { ids: ["a", "b", "c"], id: "b", direction: -1, expected: ["b", "a", "c"] },
    { ids: ["a", "b", "c"], id: "b", direction: 1, expected: ["a", "c", "b"] },
    { ids: ["a", "b", "c"], id: "a", direction: -1, expected: ["a", "b", "c"] },
    { ids: ["a", "b", "c"], id: "c", direction: 1, expected: ["a", "b", "c"] },
    { ids: ["a"], id: "missing", direction: 1, expected: ["a"] },
  ] as const

  it("只和相邻项交换，边界是无操作", () => {
    for (const item of cases) {
      expect(shifted(item.ids, item.id, item.direction)).toEqual(item.expected)
      expect(canShift(item.ids, item.id, item.direction)).toBe(
        item.expected.join() !== item.ids.join(),
      )
    }
  })
})
