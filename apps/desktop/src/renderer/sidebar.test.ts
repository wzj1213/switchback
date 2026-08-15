import { describe, expect, it } from "vitest"
import type { Thread } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { baseNameOf, groupByWorkspace, rowLabelOf } from "./sidebar.js"

const row = (id: string, cwd: string, title: string, preview?: string): ThreadRow => ({
  thread: {
    id,
    title,
    cwd,
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["codex"],
  } satisfies Thread,
  preview,
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
    expect(rowLabelOf(row("t", "/w/omni", "omni", "给 add 加 JSDoc"))).toBe("给 add 加 JSDoc")
  })

  it("标题就是目录名时不重复显示——组标题已经说过一遍了", () => {
    expect(rowLabelOf(row("t", "/w/omni", "omni"))).toBe("新会话")
  })

  it("用户自己起过标题就用它", () => {
    expect(rowLabelOf(row("t", "/w/omni", "重构审批链路"))).toBe("重构审批链路")
  })

  it("全是空白的第一句话当没有", () => {
    expect(rowLabelOf(row("t", "/w/omni", "omni", "   "))).toBe("新会话")
  })
})

describe("按工作区分组", () => {
  it("同一个目录的收在一组", () => {
    const groups = groupByWorkspace([
      row("a", "/w/omni", "omni", "第一件事"),
      row("b", "/w/other", "other", "别的事"),
      row("c", "/w/omni", "omni", "第二件事"),
    ])
    expect(groups.map((g) => g.label)).toEqual(["omni", "other"])
    expect(groups[0]?.rows.map((r) => r.thread.id)).toEqual(["a", "c"])
  })

  it("**组的先后跟着「组里最新的那个」**——传进来就是最新在前，按首次出现收集即可", () => {
    const groups = groupByWorkspace([
      row("新", "/w/b", "b"),
      row("旧", "/w/a", "a"),
      row("更旧", "/w/a", "a"),
    ])
    expect(groups.map((g) => g.cwd)).toEqual(["/w/b", "/w/a"])
  })

  it("空列表给空数组，不给一个空组", () => {
    expect(groupByWorkspace([])).toEqual([])
  })
})
