import { describe, expect, it } from "vitest"
import {
  fireStep,
  posOf,
  rpsOf,
  pushGlyph,
  spawn,
  stepShots,
  stepTape,
  TAPE_MAX,
  type Bullet,
  type Glyph,
} from "./pet-shots.js"

/** 跑 `secs` 秒，返回一共打了几发。 */
function fire(rate: number, secs: number, dt = 1 / 60): number {
  let acc = 0
  let total = 0
  for (let t = 0; t < secs; t += dt) {
    const step = fireStep(acc, rate, dt)
    acc = step.acc
    total += step.shots
  }
  return total
}

describe("fireStep", () => {
  it("零流速就是零发——没有输出就没有火力", () => {
    expect(fire(0, 3)).toBe(0)
  })

  it("发数正比于流速：一倍流速约一倍火力", () => {
    const slow = fire(40, 4)
    const fast = fire(80, 4)
    expect(slow).toBeGreaterThan(0)
    expect(fast / slow).toBeGreaterThan(1.7)
    expect(fast / slow).toBeLessThan(2.3)
  })

  it("低流速也打得出来——欠着的发数必须存着", () => {
    // 每帧欠 0.02 发，不累加的话永远打不出第一发
    expect(fire(10, 5)).toBeGreaterThan(3)
  })

  it("封顶：再快也不会变成一面读不出快慢的弹幕墙", () => {
    expect(fire(4000, 2)).toBeLessThanOrEqual(30 * 2 + 1)
  })

  it("一帧最多补几发——切后台再回来不该在一帧里炸出几十颗", () => {
    expect(fireStep(0, 4000, 5).shots).toBeLessThanOrEqual(6)
  })
})

describe("rpsOf", () => {
  it("每八个 token 一发，封顶之后不再涨", () => {
    expect(rpsOf(0)).toBe(0)
    expect(rpsOf(80)).toBe(10)
    expect(rpsOf(190)).toBeCloseTo(23.75, 6)
    expect(rpsOf(99999)).toBe(30)
  })
})

describe("spawn / posOf", () => {
  const from = { x: 100, y: 50 }
  const to = { x: 20, y: 60 }

  it("同样的输入给同样的输出——随机由调用方给", () => {
    const a = spawn(from, to, 3, [0.1, -0.2])
    const b = spawn(from, to, 3, [0.1, -0.2])
    expect(a).toEqual(b)
  })

  it("出膛在枪口，落点在纸带上，走直线", () => {
    const b = spawn(from, to, 0, [0, 0])
    expect(posOf(b)).toEqual({ x: 100, y: 50 })
    b.t = b.dur / 2
    expect(posOf(b).x).toBeCloseTo(60, 6)
    b.t = b.dur * 5
    expect(posOf(b)).toEqual({ x: 20, y: 60 })
  })
})

describe("stepShots", () => {
  const one = (): Bullet => spawn({ x: 100, y: 50 }, { x: 20, y: 60 }, 7, [0, 0])

  it("飞够时间才落地，落地时把那一发交出去", () => {
    const bullets = [one()]
    const landed: Bullet[] = []
    stepShots(bullets, 0.05, (b) => landed.push(b))
    expect(landed).toHaveLength(0)
    stepShots(bullets, 0.2, (b) => landed.push(b))
    expect(landed).toHaveLength(1)
    expect(bullets).toHaveLength(0)
    expect(landed[0]?.ch).toBe(7)
  })

  it("「打中了算什么」由调用方定——这个模块不认识敌人", () => {
    const bullets = [one()]
    let mine = 0
    stepShots(bullets, 1, () => mine++)
    expect(mine).toBe(1)
  })
})

describe("pushGlyph", () => {
  it("纸带有上限，到头丢最旧的——不然它会一直长下去", () => {
    const tape: Glyph[] = []
    for (let i = 0; i < TAPE_MAX + 40; i++) {
      pushGlyph(tape, spawn({ x: 100, y: 50 }, { x: 20, y: 60 }, i, [0, 0]))
    }
    expect(tape).toHaveLength(TAPE_MAX)
    // 丢的是最旧的：留下来的应该是后 72 个
    expect(tape[0]?.ch).toBe(40)
  })
})

describe("stepTape", () => {
  it("向左漂，漂过头就没了", () => {
    const tape: Glyph[] = [{ x: 50, y: 10, ch: 0, t: 0 }]
    stepTape(tape, 1, 20, 0)
    expect(tape[0]?.x).toBe(30)
    stepTape(tape, 2, 20, 0)
    expect(tape).toHaveLength(0)
  })

  it("漂得快就清得快——「不动」那一刻要来得到，跳帧优化才有得跳", () => {
    const slow: Glyph[] = [{ x: 90, y: 0, ch: 0, t: 0 }]
    const fast: Glyph[] = [{ x: 90, y: 0, ch: 0, t: 0 }]
    for (let i = 0; i < 72; i++) {
      stepTape(slow, 1 / 60, 13, 0)
      stepTape(fast, 1 / 60, 90, 0)
    }
    expect(slow).toHaveLength(1)
    expect(fast).toHaveLength(0)
  })
})
