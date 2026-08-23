import { describe, expect, it } from "vitest"
import { compact, level, meterOf } from "./usage.js"

describe("compact", () => {
  it("1000 以下保留原样——会话刚开始看到「0k」会让人以为它没在工作", () => {
    expect(compact(0)).toBe("0")
    expect(compact(999)).toBe("999")
  })

  it("到 k 之后保留一位小数，整数不留 .0", () => {
    expect(compact(15748)).toBe("15.7k")
    expect(compact(2000)).toBe("2k")
  })

  it("十万以上不留小数，位数太长反而不好比", () => {
    expect(compact(258400)).toBe("258k")
  })
})

describe("level", () => {
  it("七成开始提醒，九成进危险区", () => {
    expect(level(0.5)).toBe("ok")
    expect(level(0.7)).toBe("warn")
    expect(level(0.95)).toBe("danger")
  })
})

describe("meterOf", () => {
  it("没有用量就没有表", () => {
    expect(meterOf(undefined)).toBeUndefined()
  })

  it("有窗口大小时给出比例与两端数字，百分比直接写进标签", () => {
    const m = meterOf({ contextUsed: 15748, contextWindow: 258400 })
    expect(m?.label).toBe("15.7k / 258k · 6%")
    expect(m?.ratio).toBeCloseTo(0.061, 3)
    expect(m?.level).toBe("ok")
  })

  it("引擎没给窗口大小就**不画进度条**——照猜出来的分母画比不画更糟", () => {
    const m = meterOf({ contextUsed: 4200 })
    expect(m?.ratio).toBeUndefined()
    expect(m?.label).toBe("4.2k tokens")
    expect(m?.title).toContain("未提供窗口大小")
  })

  it("窗口是 0 时按「没有窗口」处理，不做除零", () => {
    expect(meterOf({ contextUsed: 10, contextWindow: 0 })?.ratio).toBeUndefined()
  })

  it("超出窗口时比例封顶在 1，进度条不会溢出", () => {
    expect(meterOf({ contextUsed: 300000, contextWindow: 258400 })?.ratio).toBe(1)
  })

  it("累计消耗进标签的**独立一段**——它是账单，不和「离上限还有多远」挤在同一组数里", () => {
    const m = meterOf({ contextUsed: 100, contextWindow: 1000, totalTokens: 99999 })
    expect(m?.label).toBe("100 / 1k · 10%")
    expect(m?.total).toBe("累计 100k")
    expect(m?.title).toContain("本会话累计 100k")
  })
})
