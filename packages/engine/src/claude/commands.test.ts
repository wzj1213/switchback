import { describe, expect, it } from "vitest"
import { captureTerminalCommands, claudeCommands } from "./commands.js"

describe("Claude 斜杠命令", () => {
  it("同一份翻译同时接开场快照与中途整份推送", () => {
    const cases = [
      { raw: undefined, want: undefined },
      { raw: [], want: [] },
      {
        raw: [
          { name: "review", description: "Review changes", argumentHint: "<path>" },
          { name: "compact", description: "Compact", argumentHint: "" },
          { name: "", description: "bad" },
          { name: "broken" },
        ],
        want: [
          { name: "review", description: "Review changes", argumentHint: "<path>", source: "engine" },
          { name: "compact", description: "Compact", source: "engine" },
        ],
      },
    ] as const
    for (const row of cases) expect(claudeCommands(row.raw)).toEqual(row.want)
  })

  it("终端专用命令既不进开场快照，也不在动态清单里复活", () => {
    const terminal = new Set<string>(["old"])
    captureTerminalCommands(
      { subtype: "init", terminal_slash_commands: ["doctor", "color", "", 1] },
      terminal,
    )
    expect(terminal).toEqual(new Set(["doctor", "color"]))
    expect(claudeCommands([
      { name: "doctor", description: "Terminal diagnostics", argumentHint: "" },
      { name: "usage", description: "Usage", argumentHint: "" },
    ], terminal)).toEqual([{ name: "usage", description: "Usage", source: "engine" }])
  })
})
