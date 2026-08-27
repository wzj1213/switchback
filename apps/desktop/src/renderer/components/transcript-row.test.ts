import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Thread } from "@omni/protocol"
import type { Item } from "@omni/protocol"
import type { Row } from "../group.js"
import { canRewind, lastSpoken } from "./transcript-row.js"

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

const say = (id: string, kind: Item["kind"], extra: Record<string, unknown> = {}): Row => ({
  kind: "item",
  item: { id, turnId: "tn", at: 1, kind, text: "x", ...extra } as Exclude<Item, { kind: "tool_call" }>,
})

describe("那排动作挂在哪一条上", () => {
  it("只认最后一条人话或回答，思考与工具行一概跨过去", () => {
    const rows: readonly Row[] = [
      say("u1", "user_message"),
      say("a1", "agent_message", { complete: true }),
      say("r1", "reasoning", { complete: true }),
      { kind: "run", items: [] },
      say("n1", "notice", { level: "info", message: "…" }),
    ]
    // 最后一条**说出来的话**是 a1，尽管它后面还压着思考、工具组和一条通知
    expect(lastSpoken(rows)).toBe("a1")
    // 一条都没有时不给：空会话、只有审批卡的那一屏都走这里
    expect(lastSpoken([{ kind: "run", items: [] }])).toBeUndefined()
  })

  it("还在吐字的回答不给——那一刻没有定稿可拿，按钮画出来只会跟着文字往下跳", () => {
    const rows: readonly Row[] = [
      say("u1", "user_message"),
      say("a1", "agent_message", { complete: false }),
    ]
    expect(lastSpoken(rows)).toBeUndefined()
    // 写完了就归它
    expect(lastSpoken([say("u1", "user_message"), say("a1", "agent_message", { complete: true })])).toBe("a1")
  })

  it("最后一条是提问时归提问：那正是「发出去了、还没回来」的那一屏", () => {
    expect(lastSpoken([say("a1", "agent_message", { complete: true }), say("u2", "user_message")])).toBe("u2")
  })
})
