import { afterEach, describe, expect, it, vi } from "vitest"
import { watchStalls } from "./stall.js"

afterEach(() => vi.useRealTimers())

describe("主进程卡顿留痕", () => {
  const cases: readonly { name: string; extra: number; want: readonly number[] }[] = [
    { name: "按时醒来：不记", extra: 0, want: [] },
    { name: "晚了一点：不记", extra: 1500, want: [] },
    { name: "晚了一大截：记下晚了多少", extra: 12_000, want: [12_000] },
  ]
  for (const one of cases) {
    it(one.name, () => {
      vi.useFakeTimers()
      const clock = { now: 0 }
      const seen: number[] = []
      const stop = watchStalls({ now: () => clock.now, report: (late) => seen.push(late), everyMs: 500, thresholdMs: 2000 })
      clock.now += 500 + one.extra
      vi.advanceTimersByTime(500)
      stop()
      expect(seen).toEqual(one.want)
    })
  }
})
