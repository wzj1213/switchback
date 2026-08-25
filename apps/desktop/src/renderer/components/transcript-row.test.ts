import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Thread } from "@omni/protocol"
import { canRewind } from "./transcript-row.js"

function threadWith(rewind: boolean): Thread {
  return {
    id: "t-1",
    cwd: "/w",
    title: "测试",
    engine: "acp:grok",
    trust: "auto-edit",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    engineHistory: ["acp:grok"],
    engineHandle: "s-1",
    capabilities: { ...NO_CAPABILITIES, fork: true, rewind },
  }
}

describe("历史回退入口", () => {
  it("完整分叉和精确回退分开判定", () => {
    expect(canRewind(threadWith(false), undefined, false)).toBe(false)
    expect(canRewind(threadWith(true), undefined, false)).toBe(true)
  })
})
