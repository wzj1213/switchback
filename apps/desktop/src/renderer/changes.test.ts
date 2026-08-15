import { describe, expect, it } from "vitest"
import type { Item, ToolCallItem } from "@omni/protocol"
import { changesOf } from "./tool.js"

const edit = (o: {
  id: string
  path: string
  added: number
  removed: number
  status?: ToolCallItem["status"]
}): Item => ({
  id: o.id,
  turnId: "t",
  at: 0,
  kind: "tool_call",
  tool: "apply_patch",
  status: o.status ?? "ok",
  detail: {
    kind: "file_edit",
    path: o.path,
    files: [{ path: o.path, kind: "update", added: o.added, removed: o.removed }],
    added: o.added,
    removed: o.removed,
  },
})

describe("变更汇总", () => {
  it("**同一个文件改三次算一个文件**，行数累加——用户关心的是有几个文件要看", () => {
    const out = changesOf([edit({ id: "a", path: "/w/x.ts", added: 3, removed: 1 }),
      edit({ id: "b", path: "/w/x.ts", added: 2, removed: 0 }),
      edit({ id: "c", path: "/w/x.ts", added: 1, removed: 1 })])
    expect(out).toEqual({ files: 1, added: 6, removed: 2 })
  })

  it("多个文件各算各的", () => {
    expect(changesOf([edit({ id: "a", path: "/w/x.ts", added: 3, removed: 0 }), edit({ id: "b", path: "/w/y.ts", added: 4, removed: 2 })])).toEqual({
      files: 2,
      added: 7,
      removed: 2,
    })
  })

  it("**没成功的编辑不算**——失败的那次没有真的改到磁盘", () => {
    expect(changesOf([edit({ id: "a", path: "/w/x.ts", added: 9, removed: 9, status: "failed" })])).toEqual({ files: 0, added: 0, removed: 0 })
  })

  it("没有编辑就是零，界面据此整枚不显示", () => {
    expect(changesOf([])).toEqual({ files: 0, added: 0, removed: 0 })
  })
})
