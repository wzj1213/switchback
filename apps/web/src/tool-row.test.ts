import { describe, expect, it } from "vitest"
import { bodyOf, hasBody, titleOf } from "./components/ToolRow.js"

describe("手机端后台终端工具行", () => {
  it("等待态在折叠标题上直接可见", () => {
    expect(
      titleOf({
        kind: "shell",
        command: "pnpm test",
        terminal: { waiting: true, inputs: [] },
      }),
    ).toBe("等后台终端 · pnpm test")
  })

  it("只有 stdin 没有 stdout 时仍然可以展开", () => {
    const detail = {
      kind: "shell" as const,
      command: "read answer",
      terminal: { waiting: false, inputs: ["yes\n"] },
    }
    expect(hasBody(detail)).toBe(true)
    expect(bodyOf(detail)).toBe("后台终端输入 1：\nyes\n")
  })

  it("stdout 与 stdin 分区，不把输入冒充成输出", () => {
    expect(
      bodyOf({
        kind: "shell",
        command: "read answer",
        output: "ready\n",
        terminal: { waiting: false, inputs: ["yes\n"] },
      }),
    ).toBe("终端输出：\nready\n\n\n后台终端输入 1：\nyes\n")
  })
})
