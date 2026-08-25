import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { emitMemoryRecall } from "./memory.js"

describe("Claude 记忆召回", () => {
  it.each([
    ["不是召回事件", { subtype: "status", memories: [] }],
    ["缺少公开模式", { subtype: "memory_recall", memories: [{ path: "/a.md", scope: "personal" }] }],
    ["没有合法来源", { subtype: "memory_recall", mode: "select", memories: [{ path: "/a.md", scope: "other" }] }],
  ])("忽略%s", (_name, raw) => {
    const events: Event[] = []
    emitMemoryRecall(raw, { turnId: "turn-1", at: 10, nextId: () => "item-1", emit: (e) => events.push(e) })
    expect(events).toEqual([])
  })

  it("保留来源与完整路径，过滤重复和控制字符", () => {
    const events: Event[] = []
    emitMemoryRecall(
      {
        subtype: "memory_recall",
        mode: "synthesize",
        memories: [
          { path: "/home/me/memory/project.md", scope: "personal" },
          { path: "https://memory.example/team\nnotes", scope: "organization", content: "正文不复制" },
          { path: "/home/me/memory/project.md", scope: "personal" },
        ],
      },
      { turnId: "turn-1", at: 10, nextId: () => "item-1", emit: (e) => events.push(e) },
    )

    expect(events).toEqual([{
      type: "item.started",
      at: 10,
      item: {
        id: "item-1",
        turnId: "turn-1",
        at: 10,
        kind: "notice",
        message: "Claude 已从记忆中召回 2 条：\n- [个人] /home/me/memory/project.md\n- [组织] https://memory.example/team�notes",
        level: "info",
      },
    }])
  })
})
