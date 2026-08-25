import { describe, expect, it } from "vitest"
import { minuteDelay } from "./useMinute.js"

describe("minuteDelay", () => {
  it("所有挂载时刻都对齐到同一个整分之后", () => {
    const cases: readonly [number, number][] = [
      [0, 60_020],
      [1, 60_019],
      [59_999, 21],
      [60_000, 60_020],
      [125_500, 54_520],
    ]
    for (const [now, want] of cases) expect(minuteDelay(now)).toBe(want)
  })
})
