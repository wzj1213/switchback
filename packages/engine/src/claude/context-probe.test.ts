import { describe, expect, it } from "vitest"
import { ContextProbe } from "./context-probe.js"

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  const box: { resolve: (value: T) => void } = { resolve: () => undefined }
  const promise = new Promise<T>((resolve) => { box.resolve = resolve })
  return { promise, resolve: box.resolve }
}

describe("Claude 上下文探测", () => {
  it("同一时刻只发一个控制请求", async () => {
    const next = deferred<{ totalTokens: number; maxTokens: number }>()
    const calls = { count: 0 }
    const handle = { getContextUsage: () => { calls.count += 1; return next.promise } }
    const probe = new ContextProbe(1000)
    const first = probe.read(handle)
    const second = probe.read(handle)
    expect(calls.count).toBe(1)
    next.resolve({ totalTokens: 12, maxTokens: 100 })
    await expect(Promise.all([first, second])).resolves.toEqual([
      { totalTokens: 12, maxTokens: 100 },
      { totalTokens: 12, maxTokens: 100 },
    ])
  })

  it("换模型后丢弃旧请求的迟到结果", async () => {
    const old = deferred<{ totalTokens: number; maxTokens: number }>()
    const fresh = deferred<{ totalTokens: number; maxTokens: number }>()
    const probe = new ContextProbe(1000)
    const staleRead = probe.read({ getContextUsage: () => old.promise })
    probe.invalidate()
    const freshRead = probe.read({ getContextUsage: () => fresh.promise })
    fresh.resolve({ totalTokens: 7, maxTokens: 200 })
    await freshRead
    old.resolve({ totalTokens: 99, maxTokens: 100 })
    await staleRead
    expect(probe.current()).toEqual({ totalTokens: 7, maxTokens: 200 })
  })

  it("畸形快照不覆盖上一份可信数据", async () => {
    const probe = new ContextProbe(1000)
    await probe.read({ getContextUsage: () => Promise.resolve({ totalTokens: 5, maxTokens: 20 }) })
    await probe.read({ getContextUsage: () => Promise.resolve({ totalTokens: Number.NaN, maxTokens: -1 }) })
    expect(probe.current()).toEqual({ totalTokens: 5, maxTokens: 20 })
  })
})
