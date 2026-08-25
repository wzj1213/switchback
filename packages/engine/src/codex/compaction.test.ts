import { describe, expect, it, vi } from "vitest"
import { startCompaction, type CompactionContext } from "./compaction.js"

function setup(call: CompactionContext["call"] = () => Promise.resolve({})) {
  const state = { codexThread: "codex-thread" as string | undefined, turn: undefined as string | undefined }
  const fail = vi.fn()
  return { ctx: { state, call, fail }, state, fail }
}

describe("Codex 上下文压缩", () => {
  it("先占住宿主轮次，再发原生开始请求", async () => {
    const calls: unknown[] = []
    const { ctx, state } = setup((method, params) => {
      calls.push([method, params, state.turn])
      return Promise.resolve({})
    })
    await startCompaction(ctx, "compact-turn")
    expect(calls).toEqual([["thread/compact/start", { threadId: "codex-thread" }, "compact-turn"]])
  })

  it("开始请求失败会收掉已占的轮次并保留原始错误", async () => {
    const error = new Error("上游拒绝")
    const { ctx, fail } = setup(() => Promise.reject(error))
    await expect(startCompaction(ctx, "compact-turn")).rejects.toBe(error)
    expect(fail).toHaveBeenCalledWith("Error: 上游拒绝")
  })
})
