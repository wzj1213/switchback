import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@omni/protocol"
import { ownerOf } from "./ctx.js"
import type { Ctx } from "./ctx.js"

const thread: Thread = {
  id: "th-1",
  title: "t",
  cwd: "/w",
  engine: "claude",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["claude"],
}

/** `ownerOf` 只用到 `turnOwner`，其余字段给个空壳就够。 */
const ctx = { turnOwner: new Map([["tu-1", "th-1"]]) } as unknown as Ctx

describe("一条事件属于哪个会话（决定落不落盘）", () => {
  it("thread.started / updated 从 thread 上取", () => {
    expect(ownerOf(ctx, { type: "thread.started", at: 0, thread })).toBe("th-1")
  })

  it("**改名必须落盘**——漏了这条的后果是改完重启就还原，而且一声不响", () => {
    expect(ownerOf(ctx, { type: "thread.renamed", at: 0, threadId: "th-1", title: "新名字" })).toBe("th-1")
  })

  it("item 通过 turnOwner 反查", () => {
    const event: Event = {
      type: "item.started",
      at: 0,
      item: { id: "it-1", kind: "agent_message", turnId: "tu-1", at: 0, text: "", complete: false },
    }
    expect(ownerOf(ctx, event)).toBe("th-1")
  })

  it("usage / engine.status / models 自己带 threadId", () => {
    expect(ownerOf(ctx, { type: "usage.updated", at: 0, threadId: "th-1", usage: {} })).toBe("th-1")
  })

  it("空 threadId 当作「不属于任何会话」——引擎级状态会这么报", () => {
    expect(ownerOf(ctx, { type: "engine.status", at: 0, threadId: "", status: "ready" })).toBeUndefined()
  })

  it("**thread.removed 不落盘**：写了只会把刚删掉的文件建回来", () => {
    expect(ownerOf(ctx, { type: "thread.removed", at: 0, threadId: "th-1" })).toBeUndefined()
  })

  it("**斜杠命令不落盘**：每次握手现问引擎，落盘只会在重放时塞回一份过期清单", () => {
    const event: Event = { type: "commands.updated", at: 0, threadId: "th-1", commands: [] }
    expect(ownerOf(ctx, event)).toBeUndefined()
  })
})
