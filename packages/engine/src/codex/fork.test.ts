import { describe, expect, it, vi } from "vitest"
import { forkCodexThread } from "./fork.js"

const history = (ids: readonly string[]) => ({ thread: { turns: ids.map((id) => ({ id })) } })
const forked = { thread: { id: "forked", turns: [] } }

describe("Codex 原生分叉边界", () => {
  it("普通分叉只复制；从历史重来读取公开历史并把保留边界交给 fork", async () => {
    const plainCall = vi.fn().mockResolvedValue(forked)
    await forkCodexThread(plainCall, { handle: "source" })
    expect(plainCall).toHaveBeenCalledOnce()
    expect(plainCall).toHaveBeenCalledWith("thread/fork", { threadId: "source" })

    const rewindCall = vi.fn().mockResolvedValueOnce(history(["t1", "t2", "t3"])).mockResolvedValueOnce(forked)
    await forkCodexThread(rewindCall, { handle: "source", dropTurns: 2 })
    expect(rewindCall).toHaveBeenNthCalledWith(1, "thread/read", {
      threadId: "source", includeTurns: true,
    })
    expect(rewindCall).toHaveBeenNthCalledWith(2, "thread/fork", {
      threadId: "source",
      lastTurnId: "t1",
    })
  })

  it("本机协议没有 beforeTurnId 时明确拒绝空历史分支，不拿完整分叉冒充", async () => {
    const call = vi.fn().mockResolvedValueOnce(history(["t1", "t2"]))
    await expect(forkCodexThread(call, { handle: "source", dropTurns: 2 }))
      .rejects.toThrow("不能从第一轮之前")
    expect(call).toHaveBeenCalledOnce()
  })

  it("轮数不够或历史没有有效 id 时明确失败，不创建完整分叉", async () => {
    const short = vi.fn().mockResolvedValueOnce(history(["t1"]))
    await expect(forkCodexThread(short, { handle: "source", dropTurns: 2 }))
      .rejects.toThrow("源会话只有 1 轮")
    expect(short).toHaveBeenCalledOnce()

    const invalid = vi.fn().mockResolvedValueOnce({ thread: { turns: [{}, { id: "t2" }] } })
    await expect(forkCodexThread(invalid, { handle: "source", dropTurns: 1 }))
      .rejects.toThrow("历史边界")
    expect(invalid).toHaveBeenCalledOnce()
  })
})
