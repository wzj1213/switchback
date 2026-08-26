import type { Event, Item, ThreadId, ToolStatus } from "@omni/protocol"
import { describe, expect, it } from "vitest"
import { createTouchedFiles } from "./touched.js"

const turn = (id: string, threadId: string): Event => ({
  type: "turn.started",
  at: 1,
  turn: { id, threadId: threadId as ThreadId, engine: "kimi", status: "running", startedAt: 1 },
})

const read = (turnId: string, path: string, status: ToolStatus = "ok", updated = false): Event => ({
  type: updated ? "item.updated" : "item.started",
  at: 2,
  item: { id: `it-${path}`, turnId, at: 2, kind: "tool_call", tool: "Read", status,
    detail: { kind: "file_read", path } } satisfies Item,
})

const edit = (turnId: string, paths: readonly string[]): Event => ({
  type: "item.updated",
  at: 3,
  item: {
    id: `it-edit-${paths.join()}`, turnId, at: 3, kind: "tool_call", tool: "Edit", status: "ok",
    detail: {
      kind: "file_edit", path: paths[0] ?? "", added: 1, removed: 0,
      files: paths.map((path) => ({ path, kind: "update" as const, added: 1, removed: 0 })),
    },
  } satisfies Item,
})

describe("会话碰过的文件名册", () => {
  it("直播那条流按 turn 认会话，读和改都算，相对路径按 cwd 归一", () => {
    const touched = createTouchedFiles()
    touched.note(turn("tn-1", "th-1"))
    touched.note(read("tn-1", "/Users/me/.codex/skills/x/SKILL.md"))
    touched.note(edit("tn-1", ["src/a.ts", "/tmp/b.md"]))

    expect(touched.allows("th-1", "/work", "/Users/me/.codex/skills/x/SKILL.md")).toBe(true)
    // 引擎报的是相对路径，界面点的是归一后的绝对路径——两边按 cwd 对齐
    expect(touched.allows("th-1", "/work", "/work/src/a.ts")).toBe(true)
    expect(touched.allows("th-1", "/work", "/tmp/b.md")).toBe(true)
    expect(touched.allows("th-1", "/work", "/tmp/never.md")).toBe(false)
    // 另一条会话的名册互不相通
    expect(touched.allows("th-2", "/work", "/tmp/b.md")).toBe(false)
  })

  it("认不出会话的 item 一概不记；历史那条路 threadId 是现成的", () => {
    const touched = createTouchedFiles()
    // 没有 turn.started 就没有归属，不能猜
    touched.note(read("tn-orphan", "/tmp/orphan.md"))
    expect(touched.allows("th-1", "/work", "/tmp/orphan.md")).toBe(false)

    touched.noteHistory("th-1", [read("tn-old", "/tmp/old.md"), turn("tn-old", "th-9")])
    expect(touched.allows("th-1", "/work", "/tmp/old.md")).toBe(true)
  })

  it("直播与历史都只放行成功的文件工具", () => {
    const touched = createTouchedFiles()
    touched.note(turn("tn-1", "th-1"))
    const statuses: readonly ToolStatus[] = ["pending", "running", "failed", "denied", "interrupted"]
    for (const status of statuses) {
      const path = `/tmp/${status}.md`
      touched.note(read("tn-1", path, status))
      touched.noteHistory("th-1", [read("tn-old", `${path}.history`, status)])
      expect(touched.allows("th-1", "/work", path)).toBe(false)
      expect(touched.allows("th-1", "/work", `${path}.history`)).toBe(false)
    }
    touched.note(read("tn-1", "/tmp/eventual.md", "running"))
    touched.note(read("tn-1", "/tmp/eventual.md", "ok", true))
    expect(touched.allows("th-1", "/work", "/tmp/eventual.md")).toBe(true)
  })

  it("按会话与路径两级淘汰，最近碰过的留下", () => {
    const touched = createTouchedFiles()
    for (let i = 0; i < 1200; i += 1) touched.noteHistory("th-1", [read("tn-1", `/tmp/f${String(i)}.md`)])
    expect(touched.allows("th-1", "/work", "/tmp/f0.md")).toBe(false)
    expect(touched.allows("th-1", "/work", "/tmp/f1199.md")).toBe(true)

    for (let i = 0; i < 60; i += 1) touched.noteHistory(`th-${String(i)}`, [read("tn-1", "/tmp/x.md")])
    expect(touched.allows("th-0", "/work", "/tmp/x.md")).toBe(false)
    expect(touched.allows("th-59", "/work", "/tmp/x.md")).toBe(true)
  })
})
