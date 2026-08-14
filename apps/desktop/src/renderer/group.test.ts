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
