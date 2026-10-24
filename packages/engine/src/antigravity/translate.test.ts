import { describe, expect, it } from "vitest"
import { fixture } from "./fixture.js"
import { outcome, TurnStream } from "./translate.js"

describe("Antigravity 原生事件", () => {
  it("结果状态照实映射，WAITING 不冒充完成", () => {
    const cases = [
      ["SUCCESS", "completed"], ["ERROR", "failed"], ["INVALID", "failed"],
      ["WAITING", "failed"], ["CANCELED", "interrupted"], ["INTERRUPTED", "interrupted"],
    ] as const
    for (const [status, expected] of cases) expect(outcome({ status })?.status).toBe(expected)
    expect(outcome({ status: "RUNNING" })).toBeUndefined()
    expect(outcome({ status: "ERROR", error: { message: "native failure" } })?.error).toBe("native failure")
    // 它没给原因时那句回落跟着界面语言；它给了就照它的原话
    expect(outcome({ status: "ERROR" })?.error).toBe("Antigravity 返回 ERROR；当前轮次无法继续")
    expect(outcome({}, "en")?.error).toBe("Antigravity returned no status; this turn can't continue")
  })

  it("保留工具参数、输出、错误；中断会收口在途工具", async () => {
    const f = await fixture()
    try {
      const stream = new TurnStream(f.req, "turn")
      const step = { step_index: 1, step_type: "tool", tool_name: "run_command" }
      stream.step({ ...step, state: "ACTIVE", tool_info: { parameters: { CommandLine: "echo hello" } } })
      stream.step({ ...step, state: "DONE", tool_info: { output: "denied", error: { message: "native deny" } } })
      expect(f.events.at(-1)).toMatchObject({ type: "item.updated", item: {
        status: "failed", error: "native deny", detail: { input: { CommandLine: "echo hello" }, output: "denied" },
      } })
      stream.step({ ...step, step_index: 2, state: "ACTIVE" })
      stream.finish("interrupted")
      expect(f.events.at(-1)).toMatchObject({ item: { status: "interrupted" } })
      stream.response("final only")
      expect(f.events.at(-1)).toMatchObject({ item: { text: "final only", complete: true } })
    } finally { await f.cleanup() }
  })
})
