import { describe, expect, it } from "vitest"
import type { Item, ToolCallItem } from "@omni/protocol"
import { groupRows } from "./group.js"

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
