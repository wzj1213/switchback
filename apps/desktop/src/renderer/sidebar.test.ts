import { describe, expect, it } from "vitest"
import type { Thread } from "@switchback/protocol"
import type { ThreadRow } from "@switchback/store"
import {
  baseNameOf,
  groupByWorkspace,
  ordered,
  orderedGroups,
  reorder,
  rowLabelOf as labelIn,
  sectionsOf,
  tallyOf,
  type Group,
  type Pins,
  type SidebarRow,
} from "./sidebar.js"

// 下面那些用例写的是中文那版
const rowLabelOf = (r: ThreadRow): string => labelIn(r, "zh-CN")
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

describe("折叠起来的项目行要说什么", () => {
  const at = (status: Thread["status"], unread?: boolean): SidebarRow => {
    const base = row({ id: `t-${status}`, cwd: "/w", title: "x" })
    return { ...base, thread: { ...base.thread, status }, ...(unread === undefined ? {} : { unread }) }
  }
  const group = (rows: readonly SidebarRow[]): Group => ({ cwd: "/w", label: "w", rows })

  const cases: { name: string; rows: readonly SidebarRow[]; want: ReturnType<typeof tallyOf> }[] = [
    { name: "空项目三个都是零", rows: [], want: { running: 0, waiting: 0, unread: 0 } },
    {
      name: "在跑的、等你批的、跑完没看的，各数各的",
      rows: [at("running"), at("waiting_approval"), at("idle", true), at("idle")],
      want: { running: 1, waiting: 1, unread: 1 },
    },
    {
      name: "跑完没看的那条又跑起来了：两边都算——它确实在跑，结果也确实还没看",
      rows: [at("running", true)],
      want: { running: 1, waiting: 0, unread: 1 },
    },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(tallyOf(group(c.rows))).toEqual(c.want)
    })
  }
})

describe("目录名", () => {
  it("取最后一段", () => {
    expect(baseNameOf("/Users/w/work/switchback")).toBe("switchback")
    expect(baseNameOf("/Users/w/work/switchback/")).toBe("switchback")
  })

  it("根目录不要变成空字符串", () => {
    expect(baseNameOf("/")).toBe("/")
    expect(baseNameOf("")).toBe("/")
  })
})

describe("一行显示什么", () => {
  it("还没人起过名时才用第一句话——它至少能区分同一项目下的几个会话", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/switchback", title: "switchback", preview: "给 add 加 JSDoc" }))).toBe("给 add 加 JSDoc")
  })

  it("**引擎自己起的名字压过第一句话**——第一句常常是一整段命令行", () => {
    const shell = "curl -s https://git.example.com/tools/setup.sh | bash && git clone …"
    // title 已经不是出生时那个目录名了，说明宿主收到过原生标题（rememberTitle）
    expect(rowLabelOf(row({ id: "t", cwd: "/w/switchback", title: "拉取仓库并配置提交钩子", preview: shell })))
      .toBe("拉取仓库并配置提交钩子")
  })

  it("标题就是目录名时不重复显示——组标题已经说过一遍了", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/switchback", title: "switchback" }))).toBe("新会话")
  })

  it("用户自己起过标题就用它", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/switchback", title: "重构审批链路" }))).toBe("重构审批链路")
  })

  it("全是空白的第一句话当没有", () => {
    expect(rowLabelOf(row({ id: "t", cwd: "/w/switchback", title: "switchback", preview: "   " }))).toBe("新会话")
  })
})

describe("按工作区分组", () => {
  it("同一个目录的收在一组", () => {
    const groups = groupByWorkspace([
      row({ id: "a", cwd: "/w/switchback", title: "switchback", preview: "第一件事" }),
      row({ id: "b", cwd: "/w/other", title: "other", preview: "别的事" }),
      row({ id: "c", cwd: "/w/switchback", title: "switchback", preview: "第二件事" }),
    ])
    expect(groups.map((g) => g.label)).toEqual(["switchback", "other"])
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
    row({ id: "a", cwd: "/w/switchback", title: "switchback", preview: "第一件事", updatedAt: 30 }),
    row({ id: "b", cwd: "/w/other", title: "other", preview: "别的事", updatedAt: 10 }),
    row({ id: "c", cwd: "/w/switchback", title: "switchback", preview: "第二件事", updatedAt: 20 }),
  ]

  it("置顶的从项目里挪走，不会两边都出现", () => {
    const out = sectionsOf(rows, pinsOf(["/w/switchback"]))
    expect(out.pinned.map((g) => g.cwd)).toEqual(["/w/switchback"])
    expect(out.projects.map((g) => g.cwd)).toEqual(["/w/other"])
  })

  it("**置顶按用户钉住的先后排**，不按活动时间——底下再自动重排一次就等于没钉", () => {
    const out = sectionsOf(rows, pinsOf(["/w/other", "/w/switchback"]))
    expect(out.pinned.map((g) => g.cwd)).toEqual(["/w/other", "/w/switchback"])
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
    for (const pins of [[], ["/w/switchback"], ["/w/other", "/w/switchback"]]) {
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
  // **默认 title 必须就是 cwd 末级**——新建会话出生时取的就是它（`useWorkspaceActions`），
  // 而「有没有名字」的判据正是「它还是不是那个目录名」（见 `rowLabelOf`）
  const row = (over: Partial<ThreadRow["thread"]> & { preview?: string }): ThreadRow =>
    ({
      thread: { id: "t", title: "proj", cwd: "/w/proj", engine: "claude", trust: "auto-edit", status: "idle", createdAt: 0, updatedAt: 0, engineHistory: ["claude"], ...over },
      preview: over.preview,
    }) as ThreadRow

  it("谁都没起过名时显示第一句提问——那通常比目录名有用", () => {
    expect(rowLabelOf(row({ preview: "帮我看看这个报错" }))).toBe("帮我看看这个报错")
  })

  it("引擎起过名就显示它，第一句提问让位", () => {
    expect(rowLabelOf(row({ preview: "帮我看看这个报错", title: "排查登录 500" }))).toBe("排查登录 500")
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
  const dragging = { kind: "thread", id: "a", cwd: "/w/one", pinned: false } as const

  it("同一个项目里可以放", () => {
    expect(canDrop(dragging, "/w/one")).toBe(true)
  })

  it("**别的项目一律不给放**：cwd 是工作区边界的真源，跨过去要么改它（偷偷换执行范围）要么不改（侧栏说谎）", () => {
    expect(canDrop(dragging, "/w/two")).toBe(false)
  })

  it("没在拖的时候什么都不给放——文件、文本拖进侧栏不该有反应", () => {
    expect(canDrop(undefined, "/w/one")).toBe(false)
  })

  it("**拖的是项目时，会话那条路一律不认**——项目落点另有一套（段落 + 项目行）", () => {
    expect(canDrop({ kind: "project", cwd: "/w/one", pinned: false }, "/w/one")).toBe(false)
  })
})

/**
 * 项目也能拖。规则和会话那条**共用一套语义**（`ordered` / `orderedGroups`）：
 * 没拖过按活跃度、拖过一次整段归你排、新的排最前。
 */
describe("项目排序", () => {
  const groups = (...cwds: string[]): Group[] => cwds.map((cwd) => ({ cwd, label: cwd, rows: [] }))

  it("没拖过就按传进来的顺序（活跃度）", () => {
    expect(orderedGroups(groups("/a", "/b"), undefined).map((g) => g.cwd)).toEqual(["/a", "/b"])
    expect(orderedGroups(groups("/a", "/b"), []).map((g) => g.cwd)).toEqual(["/a", "/b"])
  })

  it("**拖过一次，整段归你排**", () => {
    expect(orderedGroups(groups("/a", "/b", "/c"), ["/c", "/a", "/b"]).map((g) => g.cwd)).toEqual(["/c", "/a", "/b"])
  })

  it("顺序表里没提到的排最前——它最新，也最可能是你现在要点的", () => {
    expect(orderedGroups(groups("/新", "/a", "/b"), ["/a", "/b"]).map((g) => g.cwd)).toEqual(["/新", "/a", "/b"])
  })

  /** `reorder` 是会话和项目共用的那一个：拖到自己身上必须是无操作，不是抖一下。 */
  it("拖到自己身上什么都不变", () => {
    expect(reorder(["/a", "/b"], "/a", "/a")).toEqual(["/a", "/b"])
  })

  it("项目段按手动顺序出（`sectionsOf` 认 projectOrder）", () => {
    const rows = [row({ id: "t1", cwd: "/a", title: "a" }), row({ id: "t2", cwd: "/b", title: "b" })]
    const out = sectionsOf(rows, { projects: [], threads: [], order: {}, known: [], projectOrder: ["/b", "/a"] })
    expect(out.projects.map((g) => g.cwd)).toEqual(["/b", "/a"])
  })
})

describe("英文那版的标题回落", () => {
  it("连话都还没说的显示 New thread", () => {
    const row: ThreadRow = { thread: { id: "t", cwd: "/w/x", title: "x" } as Thread } as ThreadRow
    expect(labelIn(row, "en")).toBe("New thread")
  })
})
