import { describe, expect, it } from "vitest"
import type { Thread } from "@omni/protocol"
import type { ThreadRow } from "@omni/store"
import { baseNameOf, groupByWorkspace, ordered, reorder, rowLabelOf, sectionsOf, type Pins } from "./sidebar.js"
import { canDrop } from "./useThreadDrag.js"

/** 老用例只关心「置顶了哪些项目」，其余用空的。 */
const pinsOf = (projects: readonly string[]): Pins => ({ projects, threads: [], order: {} })


const row = (o: {
  id: string
  cwd: string
  title: string
  preview?: string
  updatedAt?: number
  workspaceKind?: "project" | "chat"
}): ThreadRow => ({
  thread: {
    id: o.id,
    title: o.title,
    cwd: o.cwd,
    ...(o.workspaceKind === undefined ? {} : { workspaceKind: o.workspaceKind }),
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
    const out = sectionsOf(rows, pinsOf(["/w/omni"]))
    expect(out.pinned.map((g) => g.cwd)).toEqual(["/w/omni"])
    expect(out.projects.map((g) => g.cwd)).toEqual(["/w/other"])
  })

  it("**置顶按用户钉住的先后排**，不按活动时间——底下再自动重排一次就等于没钉", () => {
    const out = sectionsOf(rows, pinsOf(["/w/other", "/w/omni"]))
    expect(out.pinned.map((g) => g.cwd)).toEqual(["/w/other", "/w/omni"])
  })

  it("置顶里写了一个不存在的路径就跳过，不留空组", () => {
    expect(sectionsOf(rows, pinsOf(["/w/删掉了"])).pinned).toEqual([])
  })

  it("「对话」段只装不属于项目的会话，按最后动过的时间排", () => {
    const withChat = [...rows, row({ id: "z", cwd: "/w/聊天目录", title: "随手问问", updatedAt: 9, workspaceKind: "chat" })]
    expect(sectionsOf(withChat, pinsOf([])).chats.map((r) => r.thread.id)).toEqual(["z"])
  })

  it("**一条会话只出现一次**——这条不变量一破，选中/改名/删除确认就会同时亮两处", () => {
    const withChat = [...rows, row({ id: "z", cwd: "/w/聊天目录", title: "随手问问", updatedAt: 9, workspaceKind: "chat" })]
    for (const pins of [[], ["/w/omni"], ["/w/other", "/w/omni"]]) {
      const out = sectionsOf(withChat, pinsOf(pins))
      const ids = [
        ...out.pinned.flatMap((g) => g.rows.map((r) => r.thread.id)),
        ...out.projects.flatMap((g) => g.rows.map((r) => r.thread.id)),
        ...out.chats.map((r) => r.thread.id),
      ]
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.sort()).toEqual(withChat.map((r) => r.thread.id).sort())
    }
  })

  it("对话不进项目树——它本来就没有项目", () => {
    const withChat = [...rows, row({ id: "z", cwd: "/w/聊天目录", title: "随手问问", updatedAt: 9, workspaceKind: "chat" })]
    const out = sectionsOf(withChat, pinsOf([]))
    expect(out.projects.some((g) => g.cwd === "/w/聊天目录")).toBe(false)
  })

  it("没有置顶时那一段是空的（界面照样渲染段头，见 SidebarSections）", () => {
    expect(sectionsOf(rows, pinsOf([])).pinned).toEqual([])
  })
})

describe("起过名的行显示名字", () => {
  const row = (over: Partial<ThreadRow["thread"]> & { preview?: string }): ThreadRow =>
    ({
      thread: { id: "t", title: "标题", cwd: "/w/proj", engine: "claude", trust: "auto-edit", status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["claude"], ...over },
      preview: over.preview,
    }) as ThreadRow

  it("没起过名时显示第一句提问——那通常比目录名有用", () => {
    expect(rowLabelOf(row({ preview: "帮我看看这个报错" }))).toBe("帮我看看这个报错")
  })

  it("**起过名之后名字最大**，盖过第一句提问；否则改名看起来毫无反应", () => {
    expect(rowLabelOf(row({ preview: "帮我看看这个报错", title: "改分页那个", named: true }))).toBe("改分页那个")
  })

  it("起过名但没有 preview 也一样", () => {
    expect(rowLabelOf(row({ title: "旧账", named: true }))).toBe("旧账")
  })
})

describe("拖动排序：项目内可以排，不能跨项目", () => {
  it("**排到某一条前面**", () => {
    expect(reorder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"])
    expect(reorder(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"])
  })

  it("拖到自己身上是无操作——那是最容易误触的一下，**必须什么都不发生**", () => {
    expect(reorder(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"])
  })

  it("放到末尾", () => {
    expect(reorder(["a", "b", "c"], "a", undefined)).toEqual(["b", "c", "a"])
  })

  it("落点不在这一组里就原样返回，不瞎排", () => {
    expect(reorder(["a", "b"], "a", "不在这组")).toEqual(["a", "b"])
  })
})

describe("排过序的项目按你排的来", () => {
  const rowsOf = (ids: readonly string[]): readonly ThreadRow[] =>
    ids.map((id) => row({ id, cwd: "/w/one", title: id }))

  it("没排过就保持传进来的顺序（那是按活跃度排好的）", () => {
    expect(ordered(rowsOf(["a", "b"]), undefined).map((r) => r.thread.id)).toEqual(["a", "b"])
    expect(ordered(rowsOf(["a", "b"]), []).map((r) => r.thread.id)).toEqual(["a", "b"])
  })

  it("排过就按存下来的顺序", () => {
    expect(ordered(rowsOf(["a", "b", "c"]), ["c", "a", "b"]).map((r) => r.thread.id)).toEqual(["c", "a", "b"])
  })

  it("**顺序表里没有的排在最前**：那是拖过之后新建的，它最新也最可能是你要点的", () => {
    expect(ordered(rowsOf(["新", "a", "b"]), ["b", "a"]).map((r) => r.thread.id)).toEqual(["新", "b", "a"])
  })

  it("顺序表里有、但会话已经删了的，自然跳过", () => {
    expect(ordered(rowsOf(["a"]), ["删了", "a"]).map((r) => r.thread.id)).toEqual(["a"])
  })
})

describe("置顶的会话", () => {
  const rows = [row({ id: "a", cwd: "/w/one", title: "a" }), row({ id: "b", cwd: "/w/one", title: "b" })]

  it("按置顶先后排，不按活跃度——钉住的顺序是你自己定的", () => {
    const out = sectionsOf(rows, { projects: [], threads: ["b", "a"], order: {} })
    expect(out.pinnedThreads.map((r) => r.thread.id)).toEqual(["b", "a"])
  })

  it("**置顶之后从项目里摘掉**：一条会话只出现一次是硬约束（两处同时亮过的坑）", () => {
    const out = sectionsOf(rows, { projects: [], threads: ["a"], order: {} })
    expect(out.projects.flatMap((g) => g.rows.map((r) => r.thread.id))).toEqual(["b"])
  })

  it("置顶的会话已经删了就不显示，不留一行空的", () => {
    const out = sectionsOf(rows, { projects: [], threads: ["没了"], order: {} })
    expect(out.pinnedThreads).toEqual([])
  })
})

describe("不能跨项目——这条是硬的", () => {
  const dragging = { id: "a", cwd: "/w/one" }

  it("同一个项目里可以放", () => {
    expect(canDrop(dragging, "/w/one")).toBe(true)
  })

  it("**别的项目一律不给放**：cwd 是工作区边界的真源，跨过去要么改它（偷偷换执行范围）要么不改（侧栏说谎）", () => {
    expect(canDrop(dragging, "/w/two")).toBe(false)
  })

  it("没在拖的时候什么都不给放——文件、文本拖进侧栏不该有反应", () => {
    expect(canDrop({ id: undefined, cwd: undefined }, "/w/one")).toBe(false)
  })
})
