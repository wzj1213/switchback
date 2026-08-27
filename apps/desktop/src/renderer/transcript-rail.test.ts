import { describe, expect, it } from "vitest"
import { navPointsOf, railLayout, railPeek, widthOf } from "./transcript-rail.js"

const ask = (id: string, top: number, weight = 200): { id: string; text: string; top: number; weight: number } =>
  ({ id, text: `第 ${id} 件事`, top, weight })

const points = [ask("a", 0), ask("b", 500), ask("c", 1800)]
const box = { scrollHeight: 2000, clientHeight: 800, scrollTop: 0 }

describe("大纲的几何", () => {
  it("滚不动就整条不画——那时候「我在哪儿」不是个问题", () => {
    const cases = [
      [{ scrollHeight: 880, clientHeight: 800, scrollTop: 0 }, "刚好差 80，不到门槛"],
      [{ scrollHeight: 800, clientHeight: 800, scrollTop: 0 }, "一屏装得下"],
      [{ scrollHeight: 0, clientHeight: 0, scrollTop: 0 }, "还没量出来"],
    ] as const
    for (const [size, why] of cases) expect(railLayout(points, size).marks, why).toEqual([])
    // 只问过一次也不画：一格导航到它自己
    expect(railLayout(points.slice(0, 1), box).marks).toEqual([])
  })

  it("聚成一块居中的短块，格距不超过 5.5px", () => {
    const { marks } = railLayout(points, box)
    expect(marks).toHaveLength(3)
    const gaps = marks.slice(1).map((mark, i) => mark.y - (marks[i]?.y ?? 0))
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(6)
    // 块落在中间：上下留白差不多
    const above = marks[0]?.y ?? 0
    const below = box.clientHeight - (marks.at(-1)?.y ?? 0)
    expect(Math.abs(above - below)).toBeLessThanOrEqual(2)
  })

  it("每格的长短由那一轮的产出定，同一份输入永远画出同一块波形", () => {
    const quiet = railLayout([ask("a", 0, 0), ask("b", 500, 0)], box).marks
    const loud = railLayout([ask("a", 0, 4000), ask("b", 500, 4000)], box).marks
    // 产出多的更长
    expect(loud[0]?.width).toBeGreaterThan(quiet[0]?.width ?? 0)
    // 同样的输入两次算出同一份（节奏是定的，不是随机的）
    expect(railLayout(points, box).marks).toEqual(railLayout(points, box).marks)
    // 长短有上下界，不会画出一根头发或者半屏宽的条
    for (const w of [0, 1, 50, 5000, 1e9]) {
      expect(widthOf(w, 3)).toBeGreaterThanOrEqual(5)
      expect(widthOf(w, 3)).toBeLessThanOrEqual(20)
    }
  })

  it("超过 32 问就并格，一格罩着连着的几问，跳到其中第一问", () => {
    const many = Array.from({ length: 90 }, (_, i) => ask(`q${i}`, i * 40))
    const { marks } = railLayout(many, { scrollHeight: 90 * 40, clientHeight: 800, scrollTop: 0 })
    expect(marks).toHaveLength(32)
    // 每一问都被某一格罩住，一个都不丢
    const covered = new Set(marks.flatMap((mark) => mark.ids))
    expect(covered.size).toBe(90)
    // 每格代表的是它罩住的第一问
    expect(marks[0]?.id).toBe(marks[0]?.ids[0])
  })

  it("当下那一格跟着视线走；被并进哪一格就算哪一格是当下", () => {
    expect(railLayout(points, box).activeId).toBe("a")
    expect(railLayout(points, { ...box, scrollTop: 400 }).activeId).toBe("b")
    // 滚到底：最后一屏里 b 和 c 都在，得是 c
    expect(railLayout(points, { ...box, scrollTop: 1200 }).activeId).toBe("c")
  })

  it("悬停卡第一行当标题，其余压成一段", () => {
    expect(railPeek("push 到 release 分支上吧\n\n先确认远端的情况，\n再决定推送方式")).toEqual({
      title: "push 到 release 分支上吧",
      body: "先确认远端的情况， 再决定推送方式",
    })
    expect(railPeek("只有一行")).toEqual({ title: "只有一行", body: "" })
    expect(railPeek("   ")).toEqual({ title: "", body: "" })
  })
})

describe("哪些行算一格、那一轮有多重", () => {
  const item = (kind: string, turnId: string, text = "", extra: Record<string, unknown> = {}) =>
    ({ kind: "item" as const, item: { id: `${turnId}-${kind}-${text.length}`, kind, turnId, text, ...extra } })

  it("只有你在这条会话里问过的那几句算一格", () => {
    const rows = [
      item("user_message", "t1", "改一下这里"),
      item("agent_message", "t1", "改完了"),
      // 接力带过来的那句不是你在这条会话里问的
      item("user_message", "t2", "接力来的", { origin: "handoff" }),
    ]
    expect(navPointsOf(rows).map((p) => p.id)).toEqual(["t1-user_message-5"])
  })

  it("重量按**整轮**累计，不是那句提问本身的长度", () => {
    const rows = [
      item("user_message", "t1", "改"),
      item("agent_message", "t1", "x".repeat(300)),
      { kind: "run" as const, items: [{ turnId: "t1", tool: "Bash" }, { turnId: "t1", tool: "Edit" }] },
    ]
    const [point] = navPointsOf(rows)
    // 1（提问）+ 300（回答）+ 2 × 24（两个工具）
    expect(point?.weight).toBe(1 + 300 + 48)
  })
})
