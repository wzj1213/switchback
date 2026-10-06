import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Thread } from "@switchback/protocol"
import type { Item } from "@switchback/protocol"
import type { Row } from "../group.js"
import { answerActs, canRewind } from "./transcript-row.js"

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

const item = (id: string, kind: Item["kind"], turnId: string, extra: Record<string, unknown> = {}) =>
  ({ id, turnId, at: 1, kind, text: "x", ...extra }) as Exclude<Item, { kind: "tool_call" }>

describe("那排动作挂在哪几条上", () => {
  it("每一轮的最后一条回答各挂一条——一屏压着好几轮，只留最后那条等于往回翻就没入口了", () => {
    const rows: readonly Row[] = [
      { kind: "item", item: item("u1", "user_message", "t1") },
      { kind: "item", item: item("a1", "agent_message", "t1", { complete: true }) },
      { kind: "run", items: [] },
      // 同一轮里说了两段：前一段是过程，末尾那段才是这一轮的结论
      { kind: "item", item: item("a2", "agent_message", "t1", { complete: true }) },
      { kind: "turn", turnId: "t2", ms: 1 },
      { kind: "item", item: item("u2", "user_message", "t2") },
      { kind: "item", item: item("a3", "agent_message", "t2", { complete: true }) },
    ]
    // 人话每一句都挂（自己写的东西常常还想再用一次），回答只挂每轮最后那段
    expect([...answerActs(rows)].sort()).toEqual(["a2", "a3", "u1", "u2"])
  })

  it("思考、通知不挂——挂在一段思考上等于说它和答案同级；人话是每条都挂的", () => {
    const rows: readonly Row[] = [
      { kind: "item", item: item("u1", "user_message", "t1") },
      { kind: "item", item: item("r1", "reasoning", "t1", { complete: true }) },
      { kind: "item", item: item("n1", "notice", "t1", { level: "info", message: "…" }) },
    ]
    expect([...answerActs(rows)]).toEqual(["u1"])
  })

  it("还在吐字的那条不给——没有定稿可拿，画出来只会跟着文字往下跳", () => {
    const running: readonly Row[] = [
      { kind: "item", item: item("a1", "agent_message", "t1", { complete: false }) },
    ]
    expect([...answerActs(running)]).toEqual([])
    // 写完了就归它
    const done: readonly Row[] = [
      { kind: "item", item: item("a1", "agent_message", "t1", { complete: true }) },
    ]
    expect([...answerActs(done)]).toEqual(["a1"])
  })
})

describe("还在跑的那一轮", () => {
  it("一条都不给——它此刻说的每一段都是中间产物，哪怕那一段自己写完了", () => {
    const rows: readonly Row[] = [
      { kind: "item", item: item("a1", "agent_message", "t1", { complete: true }) },
      { kind: "item", item: item("u2", "user_message", "t2") },
      // 这一段写完了，但它是「我先查一下…」那种过程话，后面还有
      { kind: "item", item: item("a2", "agent_message", "t2", { complete: true }) },
    ]
    expect([...answerActs(rows, "t2")].sort()).toEqual(["a1", "u2"])
    // 这一轮跑完之后它才拿到
    expect([...answerActs(rows)].sort()).toEqual(["a1", "a2", "u2"])
  })
})
