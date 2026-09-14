import { describe, expect, it } from "vitest"
import { sourceWindow } from "./source-window.js"

describe("源码视口", () => {
  const cases = [
    [100, 0, 800, { start: 0, end: 100 }],
    [100_000, 22_000, 660, { start: 970, end: 1090 }],
    [100_000, 2_200_000, 660, { start: 99_970, end: 100_000 }],
    [0, -100, 800, { start: 0, end: 0 }],
  ] as const
  for (const [count, scroll, height, expected] of cases) it(`${count} 行，滚动 ${scroll}`, () => {
    expect(sourceWindow(count, scroll, height)).toEqual(expected)
  })
})
