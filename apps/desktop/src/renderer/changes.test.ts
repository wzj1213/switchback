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
    const out = reportedChangesOf(
      [
        edit({ id: "a", path: "/w/x.ts", added: 3, removed: 1 }),
        edit({ id: "b", path: "/w/x.ts", added: 2, removed: 0 }),
        edit({ id: "c", path: "/w/x.ts", added: 1, removed: 1 }),
      ],
      "/w",
    )
    expect({ files: out.files, added: out.added, removed: out.removed }).toEqual({
      files: 1,
      added: 1,
      removed: 1,
    })
    expect(out.list.map((f) => [f.path, f.added, f.removed])).toEqual([["/w/x.ts", 1, 1]])
  })

  it("多个文件各算各的", () => {
    const out = reportedChangesOf(
      [
        edit({ id: "a", path: "/w/x.ts", added: 3, removed: 0 }),
        edit({ id: "b", path: "/w/y.ts", added: 4, removed: 2 }),
      ],
      "/w",
    )
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
      reportedChangesOf(
        [edit({ id: "a", path: "/w/x.ts", added: 9, removed: 9, status: "failed" })],
        "/w",
      ),
    ).toMatchObject({
      files: 0,
      added: 0,
      removed: 0,
    })
  })

  it("没有编辑就是零，界面据此整枚不显示", () => {
    expect(reportedChangesOf([], "/w")).toEqual({ files: 0, added: 0, removed: 0, list: [] })
  })

  it("分叉或接管抄入的历史编辑只展示在 transcript，不冒充本会话改动", () => {
    const inherited = { ...edit({ id: "old", path: "/w/old.ts", added: 9, removed: 2 }), inherited: true as const }
    expect(reportedChangesOf([inherited], "/w")).toEqual({ files: 0, added: 0, removed: 0, list: [] })
  })

  it("跨引擎的相对、绝对与 /tmp 别名先归一再去重", () => {
    const out = reportedChangesOf(
      [
        edit({ id: "a", path: "/private/tmp/w/x.ts", added: 1, removed: 0 }),
        edit({ id: "b", path: "./x.ts", added: 7, removed: 3 }),
      ],
      "/tmp/w",
    )
    expect(out.list.map((file) => [file.path, file.added, file.removed])).toEqual([
      ["/private/tmp/w/x.ts", 7, 3],
    ])
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
  const reports = reportedChangesOf(
    [
      edit({ id: "a", path: "/w/x.ts", added: 3000, removed: 0 }),
      edit({ id: "b", path: "/w/x.ts", added: 20, removed: 8 }),
      edit({ id: "c", path: "/w/y.ts", added: 5, removed: 0 }),
    ],
    "/w",
  )

  it("多轮上报再大也不参与合计，卡片采用 git 的真实净数字", () => {
    const out = reconcileChanges(reports, [review("/w/x.ts", 7, 3), review("/w/y.ts", 2, 1)], "/w")
    expect({ files: out.files, added: out.added, removed: out.removed }).toEqual({
      files: 2,
      added: 9,
      removed: 4,
    })
    expect(out.list[0]?.review?.rel).toBe("x.ts")
  })

  it("后来改回原样的文件从 git 清单消失，卡片也不再展示", () => {
    const out = reconcileChanges(reports, [review("/w/y.ts", 2, 1)], "/w")
    expect(out.list.map((file) => file.path)).toEqual(["/w/y.ts"])
  })

  it("Git 忽略的上报文件保留最后一次编辑，并明确标成无法核实", () => {
    const one = reportedChangesOf(
      [edit({ id: "a", path: "/w/ignored.txt", added: 4, removed: 2 })],
      "/w",
    )
    const out = reconcileChanges(one, [review("/w/ignored.txt", 99, 99)], "/w", {
      reported: "/w",
      real: "/w",
      ignored: ["ignored.txt"],
    })
    expect(out.list).toEqual([
      expect.objectContaining({ path: "/w/ignored.txt", added: 4, removed: 2, unverified: true }),
    ])
    expect(out.list[0]?.review).toBeUndefined()
  })

  it("工作区里与本会话无关的脏文件不会混进主数字", () => {
    const out = reconcileChanges(
      reports,
      [review("/w/x.ts", 7, 3), review("/w/other.ts", 99, 99)],
      "/w",
    )
    expect(out.list.map((file) => file.path)).toEqual(["/w/x.ts"])
  })

  it("macOS 的 /tmp 与 /private/tmp 路径能对上同一个文件", () => {
    const tmp = reportedChangesOf(
      [edit({ id: "a", path: "/tmp/w/x.ts", added: 9, removed: 9 })],
      "/tmp/w",
    )
    expect(
      reconcileChanges(tmp, [review("/private/tmp/w/x.ts", 1, 0)], "/private/tmp/w").list,
    ).toHaveLength(1)
  })

  it("同名相对路径不唯一时不猜文件，也不会挂上错误补丁", () => {
    const one = reportedChangesOf([edit({ id: "a", path: "a.ts", added: 1, removed: 0 })], "/w")
    const out = reconcileChanges(
      one,
      [review("/w/first/a.ts", 1, 0), review("/w/second/a.ts", 8, 4)],
      "/w",
    )
    expect(out.list).toEqual([])
  })

  it("即使后缀全仓唯一，也不把别的目录冒充成上报文件", () => {
    const one = reportedChangesOf(
      [edit({ id: "a", path: "src/x.ts", added: 1, removed: 0 })],
      "/repo/app",
    )
    const unrelated = { ...review("/repo/other/src/x.ts", 99, 50), rel: "other/src/x.ts" }
    expect(reconcileChanges(one, [unrelated], "/repo").list).toEqual([])
  })

  it("cwd 是符号链接时，用主进程给出的真实 cwd 对齐绝对上报路径", () => {
    const one = reportedChangesOf(
      [edit({ id: "a", path: "/linked/repo/src/x.ts", added: 8, removed: 8 })],
      "/linked/repo",
    )
    const actual = { ...review("/real/repo/src/x.ts", 2, 1), rel: "src/x.ts" }
    const out = reconcileChanges(one, [actual], "/real/repo", {
      reported: "/linked/repo",
      real: "/real/repo",
    })
    expect(out.list).toEqual([expect.objectContaining({ path: "/real/repo/src/x.ts", added: 2 })])
  })

  it("另一家把文件改名后，旧路径归属会跟到新路径", () => {
    const one = reportedChangesOf(
      [edit({ id: "a", path: "/w/old.ts", added: 1, removed: 0 })],
      "/w",
    )
    const renamed = { ...review("/w/new.ts", 2, 1), kind: "rename" as const, from: "old.ts" }
    expect(reconcileChanges(one, [renamed], "/w").list.map((file) => file.path)).toEqual([
      "/w/new.ts",
    ])
  })
})
