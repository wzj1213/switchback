import { describe, expect, it, vi } from "vitest"
import { raceStartup } from "./startup-deadline.js"

const never = <T>(): Promise<T> => new Promise(() => undefined)

describe("raceStartup", () => {
  it("RPC 先完成就返回原值", async () => {
    await expect(raceStartup(Promise.resolve("ok"), never(), 100)).resolves.toEqual({
      kind: "ready",
      value: "ok",
    })
  })

  it("进程先退出就保留原始错误", async () => {
    const error = new Error("active writer")
    await expect(raceStartup(never(), Promise.resolve(error), 100)).resolves.toEqual({
      kind: "died",
      error,
    })
  })

  it("RPC 和进程都不落定时按截止时间返回，不会永远 starting", async () => {
    vi.useFakeTimers()
    try {
      const result = raceStartup(never(), never(), 20_000)
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(result).resolves.toEqual({ kind: "timeout" })
    } finally {
      vi.useRealTimers()
    }
  })
})
