import { describe, expect, it } from "vitest"
import type { Item, ToolCallItem } from "@omni/protocol"
import { foldTurns, groupRows, withAsides } from "./group.js"

const tool = (id: string): ToolCallItem => ({
  id,
  turnId: "t1",
  kind: "tool_call",
  at: 0,
  tool: "Bash",
  status: "ok",
  detail: { kind: "shell", command: "ls" },
})

const text = (id: string): Item => ({
  id,
  turnId: "t1",
  kind: "agent_message",
  at: 0,
  text: "hi",
  complete: true,
})

describe("groupRows", () => {
  it("连续的工具调用合成一组", () => {
    const rows = groupRows([tool("a"), tool("b"), tool("c")])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind === "run" ? rows[0].items : []).toHaveLength(3)
  })

  it("被文字打断就分成两组", () => {
    const rows = groupRows([tool("a"), text("m"), tool("b")])
    expect(rows.map((r) => r.kind)).toEqual(["run", "item", "run"])
  })

  it("非工具 item 原样保留顺序", () => {
    const rows = groupRows([text("m1"), text("m2")])
    expect(rows.map((r) => (r.kind === "item" ? r.item.id : ""))).toEqual(["m1", "m2"])
  })

  it("空列表给空结果", () => {
    expect(groupRows([])).toEqual([])
  })
})

const user = (id: string, turnId: string, at: number): Item => ({
  id,
  turnId,
  kind: "user_message",
  at,
  text: "问",
})

const reply = (id: string, turnId: string, at: number): Item => ({
  id,
  turnId,
  kind: "agent_message",
  at,
  text: "答",
  complete: true,
})

describe("一轮的分界", () => {
  it("跑完的那一轮在提问后面插一条，写清楚花了多久", () => {
    const rows = groupRows([user("u", "t1", 1000), reply("a", "t1", 3500)])
    expect(rows.map((r) => r.kind)).toEqual(["item", "turn", "item"])
    expect(rows[1]?.kind === "turn" ? rows[1].ms : 0).toBe(2500)
  })

  it("**正在跑的那一轮不插**——时长还没有定数，底部的状态行正在实时报时", () => {
    const rows = groupRows([user("u", "t1", 1000), reply("a", "t1", 3500)], "t1")
    expect(rows.map((r) => r.kind)).toEqual(["item", "item"])
  })

  it("只有一条提问、还没有回答的轮次不插——没有可交代的过程", () => {
    expect(groupRows([user("u", "t1", 1000)]).map((r) => r.kind)).toEqual(["item"])
  })

  it("一轮只插一条，哪怕这一轮里有好几条 item", () => {
    const rows = groupRows([user("u", "t1", 0), tool("x"), reply("a", "t1", 900)])
    expect(rows.filter((r) => r.kind === "turn")).toHaveLength(1)
  })

  it("多轮各插各的", () => {
    const rows = groupRows([
      user("u1", "t1", 0),
      reply("a1", "t1", 1000),
      user("u2", "t2", 2000),
      reply("a2", "t2", 5000),
    ])
    const marks = rows.filter((r) => r.kind === "turn")
    expect(marks.map((m) => (m.kind === "turn" ? m.ms : 0))).toEqual([1000, 3000])
  })
})

describe("withAsides", () => {
  const ask = (at: number, q: string) => ({ at, question: q, answer: `${q}——答` })

  it("插在第一条比它晚的行之前：你问那句话时屏幕停在哪儿，它就留在哪儿", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000), reply("a2", "t1", 3000)])
    const out = withAsides(rows, [ask(2000, "这段是什么意思")])
    // 2000 落在 a1（1000）之后、a2（3000）之前
    expect(out.map((r) => r.kind)).toEqual(["item", "turn", "item", "aside", "item"])
  })

  it("问完还没有新内容的落在队尾", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000)])
    const out = withAsides(rows, [ask(9000, "顺便问一句")])
    expect(out[out.length - 1]?.kind).toBe("aside")
  })

  it("一条都没有时原样返回，连新数组都不造", () => {
    const rows = groupRows([user("u1", "t1", 0)])
    expect(withAsides(rows, [])).toBe(rows)
  })

  it("乱序进来也按时间排", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 5000)])
    const out = withAsides(rows, [ask(3000, "后问的"), ask(1000, "先问的")])
    const asks = out.flatMap((r) => (r.kind === "aside" ? [r.aside.question] : []))
    expect(asks).toEqual(["先问的", "后问的"])
  })

  it("**折起某一轮不会把侧问一起折掉**——它不归任何一轮", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000), reply("a2", "t1", 3000)])
    const folded = foldTurns(rows, new Set(["t1"]))
    const out = withAsides(folded, [ask(2000, "折起来也还在")])
    expect(out.some((r) => r.kind === "aside")).toBe(true)
  })
})
