import { describe, expect, it } from "vitest"
import type { Item, ToolCallItem } from "@omni/protocol"
import type { ReviewFile } from "../shared/review.js"
import { reconcileChanges, reportedChangesOf } from "./changes.js"

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
  it("同一个文件改三次仍算一个，但降级数字只留最后一次、绝不累加", () => {
    const out = reportedChangesOf([
      edit({ id: "a", path: "/w/x.ts", added: 3, removed: 1 }),
      edit({ id: "b", path: "/w/x.ts", added: 2, removed: 0 }),
      edit({ id: "c", path: "/w/x.ts", added: 1, removed: 1 }),
    ])
    expect({ files: out.files, added: out.added, removed: out.removed }).toEqual({
      files: 1,
      added: 1,
      removed: 1,
    })
    expect(out.list.map((f) => [f.path, f.added, f.removed])).toEqual([["/w/x.ts", 1, 1]])
  })

  it("多个文件各算各的", () => {
    const out = reportedChangesOf([
      edit({ id: "a", path: "/w/x.ts", added: 3, removed: 0 }),
      edit({ id: "b", path: "/w/y.ts", added: 4, removed: 2 }),
    ])
    expect({ files: out.files, added: out.added, removed: out.removed }).toEqual({
      files: 2,
      added: 7,
      removed: 2,
    })
    // **按首次出现排**，不按字母：你回头找的是「它刚才动的那个」
    expect(out.list.map((f) => f.path)).toEqual(["/w/x.ts", "/w/y.ts"])
  })

  it("**没成功的编辑不算**——失败的那次没有真的改到磁盘", () => {
    expect(
      reportedChangesOf([
        edit({ id: "a", path: "/w/x.ts", added: 9, removed: 9, status: "failed" }),
      ]),
    ).toMatchObject({
      files: 0,
      added: 0,
      removed: 0,
    })
  })

  it("没有编辑就是零，界面据此整枚不显示", () => {
    expect(reportedChangesOf([])).toEqual({ files: 0, added: 0, removed: 0, list: [] })
  })
})

const review = (path: string, added: number, removed: number): ReviewFile => ({
  path,
  rel: path.split("/w/")[1] ?? path,
  kind: "update",
  added,
  removed,
})

describe("用 git 当前状态校正", () => {
  const reports = reportedChangesOf([
    edit({ id: "a", path: "/w/x.ts", added: 3000, removed: 0 }),
    edit({ id: "b", path: "/w/x.ts", added: 20, removed: 8 }),
    edit({ id: "c", path: "/w/y.ts", added: 5, removed: 0 }),
  ])

  it("多轮上报再大也不参与合计，卡片采用 git 的真实净数字", () => {
    const out = reconcileChanges(reports, [review("/w/x.ts", 7, 3), review("/w/y.ts", 2, 1)])
    expect({ files: out.files, added: out.added, removed: out.removed }).toEqual({
      files: 2,
      added: 9,
      removed: 4,
    })
    expect(out.list[0]?.review?.rel).toBe("x.ts")
  })

  it("后来改回原样的文件从 git 清单消失，卡片也不再展示", () => {
    const out = reconcileChanges(reports, [review("/w/y.ts", 2, 1)])
    expect(out.list.map((file) => file.path)).toEqual(["/w/y.ts"])
  })

  it("工作区里与本会话无关的脏文件不会混进主数字", () => {
    const out = reconcileChanges(reports, [review("/w/x.ts", 7, 3), review("/w/other.ts", 99, 99)])
    expect(out.list.map((file) => file.path)).toEqual(["/w/x.ts"])
  })

  it("macOS 的 /tmp 与 /private/tmp 路径能对上同一个文件", () => {
    const tmp = reportedChangesOf([edit({ id: "a", path: "/tmp/w/x.ts", added: 9, removed: 9 })])
    expect(reconcileChanges(tmp, [review("/private/tmp/w/x.ts", 1, 0)]).list).toHaveLength(1)
  })
})
