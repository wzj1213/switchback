import { describe, expect, it } from "vitest"
import type { ToolCallItem } from "@omni/protocol"
import { applyResult, toolResults } from "./translate.js"

const call = (): ToolCallItem => ({
  id: "toolu_1",
  turnId: "t1",
  kind: "tool_call",
  at: 0,
  tool: "Bash",
  status: "running",
  detail: { kind: "shell", command: "ls" },
})

describe("toolResults", () => {
  it("从 user 消息里捞出结果——不认这一类工具调用会永远停在 running", () => {
    expect(
      toolResults([
        { type: "text", text: "无关" },
        { type: "tool_result", tool_use_id: "toolu_1", content: "a.txt" },
      ]),
    ).toEqual([{ toolUseId: "toolu_1", text: "a.txt", isError: false }])
  })

  it("content 是内容块数组时把文本拼起来", () => {
    const [r] = toolResults([
      { type: "tool_result", tool_use_id: "x", content: [{ type: "text", text: "一" }, { type: "text", text: "二" }] },
    ])
    expect(r?.text).toBe("一\n二")
  })

  it("缺 tool_use_id 的块直接跳过，不产生无主结果", () => {
    expect(toolResults([{ type: "tool_result", content: "x" }])).toEqual([])
  })
})

describe("applyResult", () => {
  it("成功时转 ok 并把输出并进 shell detail", () => {
    const next = applyResult(call(), { toolUseId: "toolu_1", text: "a.txt", isError: false })
    expect(next.status).toBe("ok")
    expect(next.detail.kind === "shell" ? next.detail.output : "").toBe("a.txt")
  })

  it("失败时转 failed 并带上 error", () => {
    const next = applyResult(call(), { toolUseId: "toolu_1", text: "boom", isError: true })
    expect(next.status).toBe("failed")
    expect(next.error).toBe("boom")
  })

  it("超长输出被截断，避免单条 item 撑爆事件流", () => {
    const next = applyResult(call(), { toolUseId: "toolu_1", text: "x".repeat(9000), isError: false })
    const output = next.detail.kind === "shell" ? (next.detail.output ?? "") : ""
    expect(output.length).toBeLessThan(4100)
    expect(output.endsWith("（已截断）")).toBe(true)
  })
})
