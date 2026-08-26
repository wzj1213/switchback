import { describe, expect, it } from "vitest"
import { activityRowDestination } from "./activity-navigation.js"

describe("活动行键盘移动", () => {
  const cases = [
    ["ArrowDown", 0, 4, 1],
    ["ArrowDown", 3, 4, 3],
    ["ArrowUp", 2, 4, 1],
    ["ArrowUp", 0, 4, 0],
    ["Home", 2, 4, 0],
    ["End", 1, 4, 3],
    ["Enter", 1, 4, undefined],
    ["ArrowDown", 0, 0, undefined],
  ] as const

  for (const [key, at, total, expected] of cases) {
    it(`${key} · ${String(at + 1)}/${String(total)} → ${String(expected)}`, () => {
      expect(activityRowDestination(key, at, total)).toBe(expected)
    })
  }
})
