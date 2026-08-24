import { describe, expect, it } from "vitest"
import type { ActivityDay } from "../shared/activity.js"
import { bigNumber, dayText, durationParts, gridOf } from "./activity-view.js"

const day = (date: string, over: Partial<ActivityDay> = {}): ActivityDay => ({
  date, tokens: 0, turns: 0, asks: 0, tools: 0, ...over,
})

/** 2026-08-24 是周一。骨架的第一列与最后一列都按周一对齐。 */
const now = Date.parse("2026-08-24T15:00:00")

describe("热力图骨架", () => {
  it("没有数据时也画满 12 周——不是空白一片，是一张还没填的日历", () => {
    const grid = gridOf([], { metric: "turns", mode: "daily", now })
    expect(grid.weeks).toHaveLength(12)
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true)
    expect(grid.weeks.flat().every((c) => c.level === 0)).toBe(true)
  })

  // 一个用了两周的人看见 51 列全空的年历，第一反应是「这图坏了」
  it("历史比 12 周长时跟着长，但不超过 53 周", () => {
    const long = [day("2020-01-01", { turns: 1 }), day("2026-08-20", { turns: 1 })]
    expect(gridOf(long, { metric: "turns", mode: "daily", now }).weeks).toHaveLength(53)
    const mid = [day("2026-02-02", { turns: 1 })]
    expect(gridOf(mid, { metric: "turns", mode: "daily", now }).weeks.length).toBeGreaterThan(12)
  })

  it("最后一格就是今天，周一在每列最上面", () => {
    const grid = gridOf([day("2026-08-24", { turns: 3 })], { metric: "turns", mode: "daily", now })
    const last = grid.weeks.at(-1)
    expect(last?.[0]?.date).toBe("2026-08-24")
    expect(last?.[0]?.value).toBe(3)
    expect(last?.[6]?.date).toBe("2026-08-30")
  })

  it("按口径取不同的数：轮次 / 消息 / 工具 / token 各看各的", () => {
    const days = [day("2026-08-24", { turns: 2, asks: 5, tools: 40, tokens: 900 })]
    const at = (metric: "turns" | "asks" | "tools" | "tokens"): number =>
      gridOf(days, { metric, mode: "daily", now }).weeks.at(-1)?.[0]?.value ?? -1
    expect([at("turns"), at("asks"), at("tools"), at("tokens")]).toEqual([2, 5, 40, 900])
  })
})

describe("三种口径共用同一副骨架", () => {
  const days = [
    day("2026-08-18", { turns: 1 }),
    day("2026-08-19", { turns: 2 }),
    day("2026-08-24", { turns: 4 }),
  ]
  const grid = (mode: "daily" | "weekly" | "total") => gridOf(days, { metric: "turns", mode, now })

  it("格子的数量与位置一个都不动，只有值变——切换时面板不会跳", () => {
    const shape = (mode: "daily" | "weekly" | "total"): string =>
      grid(mode).weeks.flat().map((c) => c.date).join(",")
    expect(shape("weekly")).toBe(shape("daily"))
    expect(shape("total")).toBe(shape("daily"))
  })

  it("每周：同一列的每一格都是那一周的合计", () => {
    // 8/18 与 8/19 同属 8/17 那一周，合计 3
    const week = grid("weekly").weeks.at(-2)
    expect(week?.map((c) => c.value)).toEqual([3, 3, 3, 3, 3, 3, 3])
  })

  it("累计：一路只增不减，最后一格是全部", () => {
    const values = grid("total").weeks.flat().map((c) => c.value)
    expect(values.every((v, i) => i === 0 || v >= (values[i - 1] ?? 0))).toBe(true)
    expect(values.at(-1)).toBe(7)
  })
})

describe("深浅按名次分", () => {
  // 等分的话一个 2.5 亿的峰值会把其余每天都压成第一档，整张图只剩一个黑点
  it("一个极端峰值不会把其余全部压成最浅那档", () => {
    const days = [
      day("2026-08-17", { turns: 10 }),
      day("2026-08-18", { turns: 20 }),
      day("2026-08-19", { turns: 30 }),
      day("2026-08-20", { turns: 250_000_000 }),
    ]
    const levels = gridOf(days, { metric: "turns", mode: "daily", now }).weeks
      .flat()
      .filter((c) => c.value > 0)
      .map((c) => c.level)
    expect(new Set(levels).size).toBeGreaterThan(1)
    expect(Math.max(...levels)).toBe(4)
  })

  it("没动过的那天是 0 档，而且带不出 day", () => {
    const grid = gridOf([day("2026-08-24", { turns: 1 })], { metric: "turns", mode: "daily", now })
    const empty = grid.weeks.at(-1)?.[1]
    expect(empty?.level).toBe(0)
    expect(empty?.day).toBeUndefined()
  })
})

describe("月份标签", () => {
  it("同一个月只标一次，标在它第一次出现的那列", () => {
    const grid = gridOf([day("2026-05-01", { turns: 1 })], { metric: "turns", mode: "daily", now })
    const labels = grid.months.map((m) => m.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.at(-1)).toBe("8月")
  })
})

describe("说成人话", () => {
  const numbers = [
    { n: 0, want: "0" },
    { n: 999, want: "999" },
    { n: 9999, want: "9999" },
    { n: 10_000, want: "1 万" },
    { n: 18_400, want: "1.84 万" },
    { n: 2_540_000, want: "254 万" },
    { n: 34_060_000_000, want: "340.6 亿" },
  ] as const
  for (const c of numbers) {
    it(`${String(c.n)} → ${c.want}`, () => {
      expect(bigNumber(c.n)).toBe(c.want)
    })
  }

  // 拆成三段是因为整串「1 天 21 小时」按大号字排出来会压到隔壁格子上
  const spans = [
    { ms: 60_000, want: { value: "1", unit: "分" } },
    { ms: 3_600_000 * 3 + 60_000 * 22, want: { value: "3", unit: "小时", tail: "22 分" } },
    { ms: 162_931_246, want: { value: "1", unit: "天", tail: "21 小时" } },
  ] as const
  for (const c of spans) {
    it(`${String(c.ms)}ms → ${c.want.value} ${c.want.unit}`, () => {
      expect(durationParts(c.ms)).toEqual(c.want)
    })
  }

  it("热力图的悬停读数不带年份", () => {
    expect(dayText("2026-08-04")).toBe("8月4日")
  })
})
