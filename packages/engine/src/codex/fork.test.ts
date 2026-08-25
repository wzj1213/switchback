import { describe, expect, it, vi } from "vitest"
import { forkCodexThread } from "./fork.js"

const page = (ids: readonly string[], nextCursor: string | null = null) => ({
  data: ids.map((id) => ({ id })),
  nextCursor,
})
const forked = { thread: { id: "forked", turns: [] } }

describe("Codex 原生分叉边界", () => {
  it("普通分叉只复制；从历史重来只倒序读取 N+1 轮并把 lastTurnId 交给 fork", async () => {
    const plainCall = vi.fn().mockResolvedValue(forked)
    await forkCodexThread(plainCall, { handle: "source" })
    expect(plainCall).toHaveBeenCalledOnce()
    expect(plainCall).toHaveBeenCalledWith("thread/fork", { threadId: "source" })

    const rewindCall = vi.fn().mockResolvedValueOnce(page(["t3", "t2", "t1"])).mockResolvedValueOnce(forked)
    await forkCodexThread(rewindCall, { handle: "source", dropTurns: 2 })
    expect(rewindCall).toHaveBeenNthCalledWith(1, "thread/turns/list", {
      threadId: "source",
      limit: 3,
      sortDirection: "desc",
      itemsView: "notLoaded",
    })
    expect(rewindCall).toHaveBeenNthCalledWith(2, "thread/fork", {
      threadId: "source",
      lastTurnId: "t1",
    })
  })

  it("从第一轮之前重来用 beforeTurnId，结果是一条空历史分支", async () => {
    const call = vi.fn().mockResolvedValueOnce(page(["t2", "t1"])).mockResolvedValueOnce(forked)
    await forkCodexThread(call, { handle: "source", dropTurns: 2 })
    expect(call).toHaveBeenNthCalledWith(2, "thread/fork", {
      threadId: "source",
      beforeTurnId: "t1",
    })
  })

  it("轮数不够或分页没有给出前一轮时明确失败，不创建完整分叉", async () => {
    const short = vi.fn().mockResolvedValueOnce(page(["t1"]))
    await expect(forkCodexThread(short, { handle: "source", dropTurns: 2 }))
      .rejects.toThrow("源会话只有 1 轮")
    expect(short).toHaveBeenCalledOnce()

    const incomplete = vi.fn().mockResolvedValueOnce(page(["t2", "t1"], "older"))
    await expect(forkCodexThread(incomplete, { handle: "source", dropTurns: 2 }))
      .rejects.toThrow("分页边界")
    expect(incomplete).toHaveBeenCalledOnce()
  })
})
