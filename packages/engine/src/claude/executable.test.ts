import { describe, expect, it } from "vitest"
import { claudePath, probeClaude, type ClaudeExecutable } from "./executable.js"

describe("Claude 可执行文件来源", () => {
  const cases: readonly {
    mode: ClaudeExecutable
    state: "ok" | "missing"
    expected: "ok" | "missing" | "unknown"
  }[] = [
    { mode: "bundled", state: "ok", expected: "ok" },
    { mode: "bundled", state: "missing", expected: "unknown" },
    { mode: "system", state: "ok", expected: "ok" },
    { mode: "system", state: "missing", expected: "missing" },
  ]

  it("完整版信任 SDK 内置版本，轻量版严格要求 PATH", async () => {
    for (const item of cases) {
      const result = await probeClaude(item.mode, async () => ({
        state: item.state,
        detail: item.state,
      }))
      expect(result.state).toBe(item.expected)
    }
  })

  it("只有轻量版把系统命令的绝对路径交给 SDK", async () => {
    const resolve = async () => "/opt/bin/claude"
    await expect(claudePath("bundled", resolve)).resolves.toBeUndefined()
    await expect(claudePath("system", resolve)).resolves.toBe("/opt/bin/claude")
  })
})
