import { describe, expect, it } from "vitest"
import { clearTarget, createTarget, effOf, land, punch, spreadOf, TG_D, TG_R } from "./pet-range.js"

const mid = (): number => 0.5

describe("effOf", () => {
  it("**唯一有资格影响命中率的是上下文**：越满，能打进去的那圈越小", () => {
    expect(effOf(0)).toBe(TG_R)
    expect(effOf(0.9)).toBeLessThan(effOf(0.53))
    expect(effOf(0.53)).toBeLessThan(effOf(0))
  })

  it("满了也不归零——归零的话「打不进去」和「靶没了」在画面上是同一件事", () => {
    expect(effOf(1)).toBeGreaterThan(0)
    expect(effOf(9)).toBe(effOf(1))
  })
})

describe("punch", () => {
  it("**后坐让弹着往上串**：连发时枪口一路上抬，这是那条 kick 曲线唯一看得见的地方", () => {
    const calm = punch({ kick: 0, ratio: 0, dist: TG_D }, mid)
    const burst = punch({ kick: 0.18, ratio: 0, dist: TG_D }, mid)
    expect(burst.y).toBeLessThan(calm.y)
  })

  it("不出靶纸：再猛的后坐也夹在靶面内", () => {
    for (const kick of [-1, 0, 5]) {
      const hole = punch({ kick, ratio: 0, dist: TG_D }, () => 0.99)
      expect(Math.abs(hole.x)).toBeLessThanOrEqual(TG_R)
      expect(Math.abs(hole.y)).toBeLessThanOrEqual(TG_R)
    }
  })

  it("**站得远打得散**：距离进了账——上一版它恒等于标称距离，桌宠动多远都不进账", () => {
    const near = punch({ kick: 0.06, ratio: 0, dist: TG_D }, mid)
    const far = punch({ kick: 0.06, ratio: 0, dist: TG_D * 2 }, mid)
    expect(Math.abs(far.y)).toBeGreaterThan(Math.abs(near.y))
  })

  it("随机那一项也按距离放大，不是只有后坐", () => {
    const roll = (): number => 0.9
    const near = punch({ kick: 0, ratio: 0, dist: TG_D }, roll)
    const far = punch({ kick: 0, ratio: 0, dist: TG_D * 2 }, roll)
    expect(Math.abs(far.x)).toBeGreaterThan(Math.abs(near.x))
  })

  it("**贴脸打不是技巧**：距离趋近 0 也不塌成正中央一个点", () => {
    expect(Math.abs(punch({ kick: 0.3, ratio: 0, dist: 0 }, mid).y)).toBeGreaterThan(0)
  })

  it("站在窝里（`dist === TG_D`）时和上一版一个数都不差", () => {
    // 缩放因子此时正好是 1：这条钉住的是「改动只在拖出去之后才生效」
    expect(punch({ kick: 0.18, ratio: 0, dist: TG_D }, mid).y).toBeCloseTo(-0.18 * 52, 10)
  })

  it("上下文满了，同一个落点从「进了」变成「脱靶」", () => {
    // kick 0.12 → 弹着离靶心 6.2px：满上下文时有效半径只剩 4.1px，正好落在两边
    const spot = { kick: 0.12, dist: TG_D }
    expect(punch({ ...spot, ratio: 0 }, mid).in).toBe(true)
    expect(punch({ ...spot, ratio: 0.95 }, mid).in).toBe(false)
  })
})

describe("land", () => {
  it("记账：命中数只在进了有效区时涨", () => {
    const target = createTarget()
    land(target, { x: 0, y: 0, in: true })
    land(target, { x: 12, y: 12, in: false })
    expect(target.shots).toBe(2)
    expect(target.hits).toBe(1)
  })

  it("洞有上限，到头丢最旧的——一百多个洞已经读不出散布", () => {
    const target = createTarget()
    for (let i = 0; i < 400; i++) land(target, { x: 0, y: 0, in: true })
    expect(target.holes.length).toBeLessThanOrEqual(140)
  })

  it("清靶把三样一起归零：留着上一轮的命中率是一句谎", () => {
    const target = createTarget()
    land(target, { x: 0, y: 0, in: true })
    clearTarget(target)
    expect(target).toEqual({ holes: [], hits: 0, shots: 0 })
  })
})

describe("spreadOf", () => {
  it("**少于四个洞说不出散布**——那时候写「—」比写一个数诚实", () => {
    const target = createTarget()
    for (let i = 0; i < 3; i++) land(target, { x: i, y: 0, in: true })
    expect(spreadOf(target)).toBeUndefined()
  })

  it("聚得紧的散布小于撒得开的", () => {
    const tight = createTarget()
    const loose = createTarget()
    for (let i = 0; i < 8; i++) {
      land(tight, { x: i % 2, y: 0, in: true })
      land(loose, { x: (i % 2) * 10, y: (i % 3) * 8, in: true })
    }
    expect(spreadOf(tight) ?? 9).toBeLessThan(spreadOf(loose) ?? 0)
  })
})
