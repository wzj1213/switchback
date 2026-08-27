import { describe, expect, it } from "vitest"
import type { Item, ToolCallItem } from "@omni/protocol"
import type { Lane } from "@omni/protocol"
import { foldTurns, groupRows, turnIdOf, withAsides, withLanes } from "./group.js"

const tool = (id: string): ToolCallItem => ({
  id,
  turnId: "t1",
  kind: "tool_call",
  at: 0,
  tool: "Bash",
  status: "ok",
  detail: { kind: "shell", command: "ls" },
})

const text = (id: string): Item => ({
  id,
  turnId: "t1",
  kind: "agent_message",
  at: 0,
  text: "hi",
  complete: true,
})

describe("groupRows", () => {
  it("连续的工具调用合成一组", () => {
    const rows = groupRows([tool("a"), tool("b"), tool("c")])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind === "run" ? rows[0].items : []).toHaveLength(3)
  })

  it("被文字打断就分成两组", () => {
    const rows = groupRows([tool("a"), text("m"), tool("b")])
    expect(rows.map((r) => r.kind)).toEqual(["run", "item", "run"])
  })

  it("非工具 item 原样保留顺序", () => {
    const rows = groupRows([text("m1"), text("m2")])
    expect(rows.map((r) => (r.kind === "item" ? r.item.id : ""))).toEqual(["m1", "m2"])
  })

  it("空列表给空结果", () => {
    expect(groupRows([])).toEqual([])
  })
})

const user = (id: string, turnId: string, at: number): Item => ({
  id,
  turnId,
  kind: "user_message",
  at,
  text: "问",
})

const reply = (id: string, turnId: string, at: number): Item => ({
  id,
  turnId,
  kind: "agent_message",
  at,
  text: "答",
  complete: true,
})

describe("一轮的分界", () => {
  it("跑完的那一轮在提问后面插一条，写清楚花了多久", () => {
    const rows = groupRows([user("u", "t1", 1000), reply("a", "t1", 3500)])
    expect(rows.map((r) => r.kind)).toEqual(["item", "turn", "item"])
    expect(rows[1]?.kind === "turn" ? rows[1].ms : 0).toBe(2500)
  })

  it("**正在跑的那一轮不插**——时长还没有定数，底部的状态行正在实时报时", () => {
    const rows = groupRows([user("u", "t1", 1000), reply("a", "t1", 3500)], "t1")
    expect(rows.map((r) => r.kind)).toEqual(["item", "item"])
  })

  it("只有一条提问、还没有回答的轮次不插——没有可交代的过程", () => {
    expect(groupRows([user("u", "t1", 1000)]).map((r) => r.kind)).toEqual(["item"])
  })

  it("一轮只插一条，哪怕这一轮里有好几条 item", () => {
    const rows = groupRows([user("u", "t1", 0), tool("x"), reply("a", "t1", 900)])
    expect(rows.filter((r) => r.kind === "turn")).toHaveLength(1)
  })

  it("多轮各插各的", () => {
    const rows = groupRows([
      user("u1", "t1", 0),
      reply("a1", "t1", 1000),
      user("u2", "t2", 2000),
      reply("a2", "t2", 5000),
    ])
    const marks = rows.filter((r) => r.kind === "turn")
    expect(marks.map((m) => (m.kind === "turn" ? m.ms : 0))).toEqual([1000, 3000])
  })
})

describe("withAsides", () => {
  const ask = (at: number, q: string) => ({ at, question: q, answer: `${q}——答` })

  it("插在第一条比它晚的行之前：你问那句话时屏幕停在哪儿，它就留在哪儿", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000), reply("a2", "t1", 3000)])
    const out = withAsides(rows, [ask(2000, "这段是什么意思")])
    // 2000 落在 a1（1000）之后、a2（3000）之前
    expect(out.map((r) => r.kind)).toEqual(["item", "turn", "item", "aside", "item"])
  })

  it("问完还没有新内容的落在队尾", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000)])
    const out = withAsides(rows, [ask(9000, "顺便问一句")])
    expect(out[out.length - 1]?.kind).toBe("aside")
  })

  it("一条都没有时原样返回，连新数组都不造", () => {
    const rows = groupRows([user("u1", "t1", 0)])
    expect(withAsides(rows, [])).toBe(rows)
  })

  it("乱序进来也按时间排", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 5000)])
    const out = withAsides(rows, [ask(3000, "后问的"), ask(1000, "先问的")])
    const asks = out.flatMap((r) => (r.kind === "aside" ? [r.aside.question] : []))
    expect(asks).toEqual(["先问的", "后问的"])
  })

  it("**折起某一轮不会把侧问一起折掉**——它不归任何一轮", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000), reply("a2", "t1", 3000)])
    const folded = foldTurns(rows, new Set(["t1"]))
    const out = withAsides(folded, [ask(2000, "折起来也还在")])
    expect(out.some((r) => r.kind === "aside")).toBe(true)
  })
})

describe("withLanes", () => {
  const lane = (at: number, id: string, patch: Partial<Lane> = {}): Lane => ({
    id, threadId: "th-1", kind: "activity", title: id, status: "running", at, ...patch,
  })

  it("按出生时刻插进去——workflow 是主循环收工之后才跑的，位置就是你起它的那一刻", () => {
    const rows = groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000), reply("a2", "t1", 3000)])
    const out = withLanes(rows, [lane(2000, "w1")])
    expect(out.map((r) => r.kind)).toEqual(["item", "turn", "item", "lane", "item"])
  })

  it("**引擎不报旁路的那三家是空数组**——空数组原样返回，一行都不多", () => {
    const rows = groupRows([user("u1", "t1", 0)])
    expect(withLanes(rows, [])).toBe(rows)
  })

  it("比所有行都晚的落队尾——跑起来之后还没有新内容，它就该在最下面", () => {
    const rows = groupRows([user("u1", "t1", 0)])
    expect(withLanes(rows, [lane(9999, "w1")]).at(-1)?.kind).toBe("lane")
  })

  it("多条按出生时刻排，标签「先开的在左边」靠的就是这个顺序", () => {
    const rows = groupRows([user("u1", "t1", 5000)])
    const out = withLanes(rows, [lane(3000, "晚"), lane(1000, "早")])
    expect(out.filter((r) => r.kind === "lane").map((r) => (r.kind === "lane" ? r.lane.id : ""))).toEqual(["早", "晚"])
  })

  it("**不归任何一轮**：折起某一轮不会把它一起折掉", () => {
    expect(turnIdOf({ kind: "lane", lane: lane(0, "w1") })).toBeUndefined()
    const rows = withLanes(groupRows([user("u1", "t1", 0), reply("a1", "t1", 1000)]), [lane(500, "w1")])
    expect(foldTurns(rows, new Set(["t1"])).some((r) => r.kind === "lane")).toBe(true)
  })
})

describe("每轮末尾那张「改了哪些文件」", () => {
  const edit = (id: string, turnId: string, path: string, added: number): Item => ({
    id, turnId, at: 1, kind: "tool_call", tool: "Edit", status: "ok",
    detail: { kind: "file_edit", path, added, removed: 0,
      files: [{ path, kind: "update", added, removed: 0 }] },
  })
  const say = (id: string, turnId: string): Item =>
    ({ id, turnId, at: 1, kind: "user_message", text: "改一下" }) as Item

  it("一轮一张，跟在那一轮末尾——换轮那一刻补上一轮的", () => {
    const rows = groupRows([
      say("u1", "t1"), edit("e1", "t1", "a.ts", 3),
      say("u2", "t2"), edit("e2", "t2", "b.ts", 5),
    ], undefined, "/w")
    const cards = rows.flatMap((row) => (row.kind === "edits" ? [row] : []))
    expect(cards.map((c) => c.turnId)).toEqual(["t1", "t2"])
    expect(cards[0]?.edits.list.map((f) => f.path)).toEqual(["/w/a.ts"])
    // 第一张必须排在第二轮的提问**之前**：它属于上一轮
    const first = rows.findIndex((row) => row.kind === "edits")
    const asked = rows.findIndex((row) => row.kind === "item" && row.item.id === "u2")
    expect(first).toBeLessThan(asked)
  })

  it("没改过文件的那一轮不插——空卡片比没有更吵", () => {
    const rows = groupRows([say("u1", "t1")], undefined, "/w")
    expect(rows.some((row) => row.kind === "edits")).toBe(false)
  })

  it("没给 cwd 就一张都不插：引擎报的路径归一不了（活动页那种场景）", () => {
    const rows = groupRows([say("u1", "t1"), edit("e1", "t1", "a.ts", 3)])
    expect(rows.some((row) => row.kind === "edits")).toBe(false)
  })
})
