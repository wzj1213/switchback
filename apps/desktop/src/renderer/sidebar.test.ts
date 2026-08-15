import { describe, expect, it } from "vitest"
import type { Thread } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { baseNameOf, groupByWorkspace, rowLabelOf, sectionsOf } from "./sidebar.js"

const row = (o: {
  id: string
  cwd: string
  title: string
  preview?: string
  updatedAt?: number
}): ThreadRow => ({
  thread: {
    id: o.id,
    title: o.title,
    cwd: o.cwd,
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 0,
    updatedAt: o.updatedAt ?? 0,
    engineHistory: ["codex"],
  } satisfies Thread,
  preview: o.preview,
})

describe("目录名", () => {
  it("取最后一段", () => {
    expect(baseNameOf("/Users/w/work/omni")).toBe("omni")
    expect(baseNameOf("/Users/w/work/omni/")).toBe("omni")
  })

  it("根目录不要变成空字符串", () => {
    expect(baseNameOf("/")).toBe("/")
    expect(baseNameOf("")).toBe("/")
  })
})

describe("一行显示什么", () => {
  it("**第一句话优先**——真正区分同一项目下几个会话的就是它", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/omni", title: "omni", preview: "给 add 加 JSDoc" }))).toBe("给 add 加 JSDoc")
  })

  it("标题就是目录名时不重复显示——组标题已经说过一遍了", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/omni", title: "omni" }))).toBe("新会话")
  })

  it("用户自己起过标题就用它", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/omni", title: "重构审批链路" }))).toBe("重构审批链路")
  })

  it("全是空白的第一句话当没有", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/omni", title: "omni", preview: "   " }))).toBe("新会话")
  })
})

describe("按工作区分组", () => {
  it("同一个目录的收在一组", () => {
    const groups = groupByWorkspace([
      row({ id: "a", cwd: "/w/omni", title: "omni", preview: "第一件事" }),
      row({ id: "b", cwd: "/w/other", title: "other", preview: "别的事" }),
      row({ id: "c", cwd: "/w/omni", title: "omni", preview: "第二件事" }),
    ])
    expect(groups.map((g) => g.label)).toEqual(["omni", "other"])
    expect(groups[0]?.rows.map((r) => r.thread.id)).toEqual(["a", "c"])
  })

  it("**组的先后跟着「组里最新的那个」**——传进来就是最新在前，按首次出现收集即可", () => {
    const groups = groupByWorkspace([
      row({ id: "新", cwd: "/w/b", title: "b" }),
      row({ id: "旧", cwd: "/w/a", title: "a" }),
      row({ id: "更旧", cwd: "/w/a", title: "a" }),
    ])
    expect(groups.map((g) => g.cwd)).toEqual(["/w/b", "/w/a"])
  })

  it("空列表给空数组，不给一个空组", () => {
    expect(groupByWorkspace([])).toEqual([])
  })
})

describe("侧栏分三段", () => {
  const rows = [
    row({ id: "a", cwd: "/w/omni", title: "omni", preview: "第一件事", updatedAt: 30 }),
    row({ id: "b", cwd: "/w/other", title: "other", preview: "别的事", updatedAt: 10 }),
    row({ id: "c", cwd: "/w/omni", title: "omni", preview: "第二件事", updatedAt: 20 }),
  ]

  it("置顶的从项目里挪走，不会两边都出现", () => {
    const out = sectionsOf(rows, ["/w/omni"])
    expect(out.pinned.map((g) => g.cwd)).toEqual(["/w/omni"])
    expect(out.projects.map((g) => g.cwd)).toEqual(["/w/other"])
  })

  it("**置顶按用户钉住的先后排**，不按活动时间——底下再自动重排一次就等于没钉", () => {
    const out = sectionsOf(rows, ["/w/other", "/w/omni"])
    expect(out.pinned.map((g) => g.cwd)).toEqual(["/w/other", "/w/omni"])
  })

  it("置顶里写了一个不存在的路径就跳过，不留空组", () => {
    expect(sectionsOf(rows, ["/w/删掉了"]).pinned).toEqual([])
  })

  it("最近是**跨项目扁平**的，按最后动过的时间排——「我刚才在干嘛」是跨项目的问题", () => {
    expect(sectionsOf(rows, []).recent.map((r) => r.thread.id)).toEqual(["a", "c", "b"])
  })

  it("最近和上面的项目树会重复，这是有意的：两条路通向同一个东西", () => {
    const out = sectionsOf(rows, ["/w/omni"])
    expect(out.recent.some((r) => r.thread.cwd === "/w/omni")).toBe(true)
  })

  it("没有置顶时那一段是空的，界面据此整段不显示", () => {
    expect(sectionsOf(rows, []).pinned).toEqual([])
  })
})
