import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@switchback/protocol"
import { createThreadTrust } from "./thread-trust.js"

const thread = (trust: Thread["trust"]): Thread => ({
  id: "th-1", title: "t", cwd: "/w", engine: "codex", trust, status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["codex"],
})

describe("每条会话开在哪一档", () => {
  it("全量重建读到的历史按最后那份记录；之后的改档、删除跟着事件走", () => {
    const index = createThreadTrust()
    const history: Event[] = [
      { type: "thread.started", at: 1, thread: thread("full") },
      { type: "thread.updated", at: 2, thread: thread("auto-edit") },
      { type: "turn.started", at: 3, turn: { id: "u1", threadId: "th-1", engine: "codex", status: "running", startedAt: 3 } },
    ]
    index.noteHistory("th-1", history)
    expect(index.of("th-1")).toBe("auto-edit")
    index.note({ type: "thread.updated", at: 4, thread: thread("read-only") })
    expect(index.of("th-1")).toBe("read-only")
    index.note({ type: "thread.removed", at: 5, threadId: "th-1" })
    expect(index.of("th-1")).toBeUndefined()
  })
})
