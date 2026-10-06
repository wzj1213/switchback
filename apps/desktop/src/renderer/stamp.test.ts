import { describe, expect, it } from "vitest"
import type { Item, Turn } from "@switchback/protocol"
import { stampOf } from "./stamp.js"

function shell(id: string, status: "running" | "ok", lane = false): Item {
  return {
    id, turnId: "turn", at: 1, kind: "tool_call", tool: "shell", status,
    detail: { kind: "shell", command: "touch src/a.ts", cwd: "/work" },
    ...(lane ? { lane: { id: "side" } } : {}),
  }
}

describe("工作区刷新节拍", () => {
  it("轮次状态与已结束 shell 会推进，运行中 shell 和普通文件项不会", () => {
    const turn = { id: "turn", threadId: "thread", engine: "codex", status: "running",
      startedAt: 1 } satisfies Turn
    const edit = { id: "edit", turnId: "turn", at: 2, kind: "tool_call", tool: "edit", status: "ok",
      detail: { kind: "file_edit", path: "src/a.ts", files: [], added: 1, removed: 0 } } satisfies Item
    const cases = [
      [undefined, [], "idle:0"],
      [turn, [], "turn:running:0"],
      [turn, [shell("running", "running")], "turn:running:0"],
      [turn, [edit], "turn:running:0"],
      [turn, [shell("done", "ok")], "turn:running:1"],
      [turn, [shell("main", "ok"), shell("lane", "ok", true)], "turn:running:2"],
      [{ ...turn, status: "completed" }, [], "turn:completed:0"],
    ] as const
    for (const [current, items, expected] of cases) expect(stampOf(current, items)).toBe(expected)
  })
})
