import { describe, expect, it } from "vitest"
import { clamp, createGun, kickOf, MAX_DT, stepGun, wrapAngle, type Gun, type GunInput } from "./pet-gun.js"

const HAND = { x: 100, y: 50 }
const input = (over: Partial<GunInput> = {}): GunInput => ({
  hand: HAND,
  want: Math.PI,
  armed: true,
  hard: false,
  ...over,
})

/** 跑 n 帧，每帧 dt。 */
function run(gun: Gun, n: number, over: Partial<GunInput> = {}, dt = 1 / 60): Gun {
  let g = gun
  for (let i = 0; i < n; i++) g = stepGun(g, dt, input(over))
  return g
}

describe("stepGun", () => {
  it("第一帧直接就位，不从画布左上角飞过来", () => {
    const g = stepGun(createGun(), 1 / 60, input())
    expect(g.x).toBe(HAND.x)
    expect(g.y).toBe(HAND.y)
    expect(g.placed).toBe(true)
  })

  it("跟着手走，且永远飘不出手掌", () => {
    let g = run(createGun(), 5)
    g = run(g, 40, { hand: { x: 300, y: 50 } })
    expect(Math.abs(g.x - 300)).toBeLessThanOrEqual(6.001)
  })

  it("端着就抽出来，安静够久才收——不是一停就收", () => {
    const armed = run(createGun(), 40)
    expect(armed.arm).toBeGreaterThan(0.9)
    // 刚安静的头一秒还端着（宽限 1.5s）
    const brief = run(armed, 30, { armed: false })
    expect(brief.arm).toBeGreaterThan(0.9)
    const long = run(armed, 60 * 4, { armed: false })
    expect(long.arm).toBe(0)
  })

  it("手里要换别的东西时不给宽限——枪和终端不能同时在手上", () => {
    const armed = run(createGun(), 40)
    const hard = run(armed, 30, { armed: false, hard: true })
    expect(hard.arm).toBeLessThan(0.6)
  })

  it("转向走最短的一边：从 -179° 到 +179° 不该穿过 0°", () => {
    let g = run(createGun(), 40, { want: -Math.PI + 0.02 })
    const before = g.ang
    g = stepGun(g, 1 / 60, input({ want: Math.PI - 0.02 }))
    // 走最短路的话第一帧应该继续往负方向去（绕过 ±π），而不是掉头奔向 0
    expect(g.ang).toBeLessThan(before + 0.05)
  })

  it("开一发是枪口上跳，不是下压——canvas 的 +y 朝下", () => {
    const armed = run(createGun(), 40)
    const shot = run(kickOf(armed, 1), 3)
    expect(shot.kick).toBeGreaterThan(0)
  })

  it("连发压着连发，但封顶——不然枪口一路抬到天上", () => {
    let g = run(createGun(), 40)
    for (let i = 0; i < 60; i++) g = run(kickOf(g, 3), 1)
    expect(g.kick).toBeLessThanOrEqual(0.2)
  })

  it("夹住 dt 之后，弹簧在最坏情况下也不发散", () => {
    let g = run(createGun(), 5)
    // 每帧都把手瞬移到另一头，用最大允许步长跑很久
    for (let i = 0; i < 4000; i++) {
      g = stepGun(g, MAX_DT, input({ hand: { x: i % 2 === 0 ? 0 : 900, y: i % 2 === 0 ? 0 : 400 } }))
    }
    for (const v of [g.x, g.y, g.vx, g.vy, g.ang, g.angV, g.kick, g.kickV, g.arm]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe("wrapAngle", () => {
  it("绕回 ±π 之内", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6)
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 6)
    expect(wrapAngle(0.3)).toBeCloseTo(0.3, 6)
    expect(Math.abs(wrapAngle(Math.PI * 7.3))).toBeLessThanOrEqual(Math.PI + 1e-9)
  })
})

describe("clamp", () => {
  it("NaN 不放行——一路弹簧发散不该把 NaN 传遍全场", () => {
    expect(clamp(Number.NaN, 1, 9)).toBe(1)
    expect(clamp(Number.POSITIVE_INFINITY, 1, 9)).toBe(9)
  })
})
