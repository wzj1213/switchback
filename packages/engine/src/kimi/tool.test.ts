import { describe, expect, it } from "vitest"
import { finishTool, startTool } from "./tool.js"

describe("Kimi 工具翻译", () => {
  it("命令保留原文、cwd、输出与退出码", () => {
    const started = startTool(
      { toolCallId: "tc1", name: "Shell", display: { kind: "command", command: "pnpm test", cwd: "/w" } },
      "turn-1",
      1,
    )
    expect(started).toMatchObject({
      id: "tc1",
      tool: "Shell",
      status: "running",
      detail: { kind: "shell", command: "pnpm test", cwd: "/w" },
    })
    expect(started === undefined ? undefined : finishTool(started, { stdout: "ok", exit_code: 0 }, false)).toMatchObject({
      status: "ok",
      detail: { kind: "shell", output: "ok", exitCode: 0 },
    })
  })

  it("文件前后全文合成真正的改动范围", () => {
    const item = startTool(
      { toolCallId: "tc2", name: "Edit", display: { kind: "diff", path: "a.ts", before: "a\nb\n", after: "a\nc\n" } },
      "turn-1",
      1,
    )
    expect(item?.detail).toMatchObject({ kind: "file_edit", path: "a.ts", added: 1, removed: 1 })
  })
})
