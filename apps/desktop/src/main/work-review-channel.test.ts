import type { Worksite } from "@switchback/worksite"
import { describe, expect, it, vi } from "vitest"
import { createWorksiteSearch } from "./worksite-search.js"
import { createWorkReviewChannels, type WorkReviewOps } from "./work-review-channel.js"

describe("Git 审核通道工作区边界", () => {
  it("拒绝未知配对和畸形请求，合法请求才进入 Git 逻辑并收紧输入", async () => {
    const worksites = createWorksiteSearch(() => ({ search: async () => [], invalidate: vi.fn() }) as Worksite)
    worksites.note({
      type: "thread.started",
      at: 1,
      thread: {
        id: "th-1", title: "测试", cwd: "/work", engine: "codex", trust: "auto-edit",
        status: "idle", createdAt: 1, updatedAt: 1, engineHistory: ["codex"],
      },
    })
    const review = vi.fn<WorkReviewOps["review"]>(async () => undefined)
    const patch = vi.fn<WorkReviewOps["patch"]>(async () => ({ patch: "ok", added: 1, removed: 0 }))
    const channels = createWorkReviewChannels(worksites, undefined, { review, patch })

    for (const request of [undefined, { cwd: "/work" }, { threadId: "other", cwd: "/work" },
      { threadId: "th-1", cwd: "/private" }, { threadId: "th-1", cwd: "/work", wanted: [42] }]) {
      await expect(channels.review(request)).resolves.toBeUndefined()
    }
    await expect(channels.patch({ threadId: "th-1", cwd: "/work", rel: "" }))
      .resolves.toMatchObject({ skip: "gone" })
    expect(review).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()

    await channels.review({ threadId: "th-1", cwd: "/work", wanted: ["x".repeat(5000)] })
    await channels.patch({ threadId: "th-1", cwd: "/work", rel: "a.ts", context: Number.POSITIVE_INFINITY })
    expect(review.mock.calls[0]?.[1]?.wanted?.[0]).toHaveLength(4096)
    expect(patch).toHaveBeenCalledWith("/work", "a.ts", 3, expect.objectContaining({ threadId: "th-1" }))
  })
})
