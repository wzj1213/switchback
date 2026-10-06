import { describe, expect, it } from "vitest"
import { foldTurns, groupRows } from "./group.js"
import type { Item, ToolCallItem } from "@switchback/protocol"

const item = (id: string, kind: Item["kind"], turnId: string, at: number): Item =>
  ({ id, kind, turnId, at, text: id }) as Item

const tool = (id: string, turnId: string, at: number): ToolCallItem =>
  ({ id, turnId, at, kind: "tool_call", tool: "Bash", status: "ok",
    detail: { kind: "shell", command: "ls" } }) as ToolCallItem

/** 两轮，每轮都是：提问 → 思考 → 跑命令 → 回答。 */
const ITEMS: readonly Item[] = [
  item("q1", "user_message", "t1", 0),
  item("r1", "reasoning", "t1", 1000),
  tool("x1", "t1", 2000),
  item("a1", "agent_message", "t1", 5000),
  item("q2", "user_message", "t2", 6000),
  item("r2", "reasoning", "t2", 7000),
  item("a2", "agent_message", "t2", 9000),
]

const inSet = (ids: readonly string[]) => (turnId: string): boolean => ids.includes(turnId)
const idsOf = (rows: ReturnType<typeof groupRows>): readonly string[] =>
  rows.flatMap((row) => (row.kind === "item" ? [row.item.id] : []))

describe("折起一轮的过程", () => {
  it("**折的是过程，不是答案**：思考和工具组藏起来，提问和回答都留着", () => {
    const folded = foldTurns(groupRows(ITEMS), inSet(["t1"]))
    const ids = idsOf(folded)
    // 人是靠自己问过的话定位的；而回答是这一轮的结论，藏了等于清空
    expect(ids).toContain("q1")
    expect(ids).toContain("a1")
    expect(ids).not.toContain("r1")
    // 工具组整组不见
    expect(folded.some((row) => row.kind === "run")).toBe(false)
  })

  it("分界线自己留着——不然没有地方点开", () => {
    expect(foldTurns(groupRows(ITEMS), inSet(["t1"])).some((r) => r.kind === "turn")).toBe(true)
  })

  it("只折被点的那一轮，别的轮一条不少", () => {
    const ids = idsOf(foldTurns(groupRows(ITEMS), inSet(["t1"])))
    expect(ids).toContain("r2")
    expect(ids).toContain("a2")
  })

  it("**没有分界线的那一轮不折**——那时候折了就没有地方点回来", () => {
    // 所有 item 同一个时间戳 ⇒ `markFor` 不插分界线（零时长）
    const flat: readonly Item[] = [
      item("q1", "user_message", "t1", 0),
      item("r1", "reasoning", "t1", 0),
      tool("x1", "t1", 0),
      item("a1", "agent_message", "t1", 0),
    ]
    const rows = groupRows(flat)
    expect(rows.some((row) => row.kind === "turn")).toBe(false)
    expect(foldTurns(rows, () => true)).toEqual(rows)
  })

  it("没折任何一轮时原样返回", () => {
    const rows = groupRows(ITEMS)
    expect(foldTurns(rows, () => false)).toEqual(rows)
  })
})

/** 一次成功的文件编辑——有 cwd 时它让 `groupRows` 在这一轮末尾插改动卡。 */
const edit = (id: string, turnId: string, at: number): ToolCallItem =>
  ({ id, turnId, at, kind: "tool_call", tool: "Edit", status: "ok",
    detail: { kind: "file_edit", path: "src/a.ts", added: 3, removed: 1,
      files: [{ path: "src/a.ts", kind: "update", added: 3, removed: 1 }] } }) as ToolCallItem

/** item 与工具组的 id 全收——单收 item 的话，「工具组折掉了」这个断言会平凡为真。 */
const presentIds = (rows: ReturnType<typeof groupRows>): readonly string[] =>
  rows.flatMap((row) => {
    if (row.kind === "item") return [row.item.id]
    if (row.kind === "run") return row.items.map((i) => i.id)
    return []
  })

describe("折起范围扩大：过程全折，只留提问、结论、改动卡和报错", () => {
  const CASES: readonly {
    name: string
    items: readonly Item[]
    /** 折后必须还在的 id。 */
    keep: readonly string[]
    /** 折后必须不见的 id（含工具调用）。 */
    gone: readonly string[]
    /** 改动卡要不要还在。 */
    edits: boolean
  }[] = [
    {
      name: "多段叙述与工具穿插的长轮：只剩提问、最终回答和改动卡",
      items: [
        item("q1", "user_message", "t1", 0),
        item("a1", "agent_message", "t1", 1000),
        tool("x1", "t1", 2000),
        item("a2", "agent_message", "t1", 3000),
        edit("x2", "t1", 4000),
        item("r1", "reasoning", "t1", 5000),
        item("a3", "agent_message", "t1", 6000),
      ],
      keep: ["q1", "a3"],
      gone: ["a1", "a2", "r1", "x1", "x2"],
      edits: true,
    },
    {
      name: "轮内带报错：报错保留——故障不能跟着过程一起藏起来",
      items: [
        item("q1", "user_message", "t1", 0),
        item("a1", "agent_message", "t1", 1000),
        tool("x1", "t1", 2000),
        item("e1", "error", "t1", 3000),
        item("a2", "agent_message", "t1", 4000),
      ],
      keep: ["q1", "e1", "a2"],
      gone: ["a1", "x1"],
      edits: false,
    },
    {
      // 一条 agent 文本都没有 ⇒ 没有「非最后一条」可折，行为与旧版相同
      name: "没有 agent 文本的轮（纯工具 + 报错）：行为不变",
      items: [
        item("q1", "user_message", "t1", 0),
        tool("x1", "t1", 1000),
        tool("x2", "t1", 2000),
        item("e1", "error", "t1", 3000),
      ],
      keep: ["q1", "e1"],
      gone: ["x1", "x2"],
      edits: false,
    },
    {
      name: "最后一条是工具调用而不是文本：最后一条文本仍保留",
      items: [
        item("q1", "user_message", "t1", 0),
        tool("x1", "t1", 1000),
        item("a1", "agent_message", "t1", 2000),
        item("a2", "agent_message", "t1", 3000),
        tool("x2", "t1", 4000),
      ],
      keep: ["q1", "a2"],
      gone: ["a1", "x1", "x2"],
      edits: false,
    },
  ]
  for (const c of CASES) {
    it(c.name, () => {
      const folded = foldTurns(groupRows(c.items, undefined, "/w"), inSet(["t1"]))
      const ids = presentIds(folded)
      for (const id of c.keep) expect(ids).toContain(id)
      for (const id of c.gone) expect(ids).not.toContain(id)
      expect(folded.some((row) => row.kind === "edits")).toBe(c.edits)
    })
  }
})
