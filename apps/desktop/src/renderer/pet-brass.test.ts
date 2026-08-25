import { describe, expect, it } from "vitest"
import {
  brassMoving,
  createBrass,
  eject,
  heave,
  stepBrass,
  sweep,
  type Brass,
  type BrassMode,
  type Case,
} from "./pet-brass.js"

const rand = (): number => 0.5
const at = { x: 100, y: 40, angle: Math.PI, ground: 60 }

const shoot = (mode: BrassMode, times = 1): ReturnType<typeof createBrass> => {
  const brass = createBrass()
  for (let i = 0; i < times; i++) eject(brass, mode, at, rand)
  return brass
}

describe("eject", () => {
  const cases: readonly { mode: BrassMode; flying: number; pile: number }[] = [
    { mode: "off", flying: 0, pile: 0 },
    { mode: "eject", flying: 1, pile: 0 },
    { mode: "pile", flying: 0, pile: 1 },
  ]
  for (const one of cases) {
    it(`「${one.mode}」档抛到该去的那一路`, () => {
      const brass = shoot(one.mode)
      expect(brass.flying).toHaveLength(one.flying)
      expect(brass.pile).toHaveLength(one.pile)
    })
  }

  it("两路各有上限，到头丢最旧的——不封的话一轮长会话能攒出几万枚", () => {
    expect(shoot("eject", 200).flying.length).toBeLessThanOrEqual(26)
    expect(shoot("pile", 200).pile.length).toBeLessThanOrEqual(70)
  })
})

describe("stepBrass", () => {
  it("抛出去那一路一秒就没了", () => {
    const brass = shoot("eject")
    for (let t = 0; t < 1.2; t += 1 / 60) stepBrass(brass, 1 / 60)
    expect(brass.flying).toHaveLength(0)
  })

  it("**堆着那一路落地就停，而且停了就不再算在动**——不钉住的话它会以亚像素幅度永远抖，空闲跳帧永远等不到机会", () => {
    const brass = shoot("pile")
    for (let t = 0; t < 3; t += 1 / 60) stepBrass(brass, 1 / 60)
    expect(brass.pile).toHaveLength(1)
    expect(brass.pile[0]?.rest).toBe(true)
    expect(brassMoving(brass)).toBe(false)
  })
})

describe("sweep", () => {
  it("结账那一下整堆扫走，扫完就空了", () => {
    const brass = shoot("pile", 5)
    for (let t = 0; t < 3; t += 1 / 60) stepBrass(brass, 1 / 60)
    sweep(brass, rand)
    expect(brassMoving(brass)).toBe(true)
    for (let t = 0; t < 1; t += 1 / 60) stepBrass(brass, 1 / 60)
    expect(brass.pile).toHaveLength(0)
  })
})

describe("heave（抛壳那一档的主角壳）", () => {
  /**
   * **判据是弧有多高，不是「谁高一点」。**
   *
   * 第一版比的是两者的最高点，而两边的初速本来就差着一点（-93 对 -100），
   * 于是把重力改回去、弧整个塌下来，那条断言照样成立——扰动一条都没红。
   * 弧高 ∝ v²/2g，所以要比的是**倍数**：420 与 560 之间差 1.55 倍，
   * 只靠初速的差别只能买到 1.16 倍。
   */
  const riseOf = (put: (brass: Brass) => void): number => {
    const brass = createBrass()
    put(brass)
    const one = brass.flying[0] as Case
    const from = one.y
    let top = from
    for (let t = 0; t < 1.5; t += 1 / 60) {
      stepBrass(brass, 1 / 60)
      top = Math.min(top, one.y)
    }
    return from - top
  }

  it("**主角那枚要飘得起来**：整条弧看得清，才读得出这一下有多大劲", () => {
    const side = riseOf((b) => {
      eject(b, "eject", at, rand)
    })
    const hero = riseOf((b) => {
      heave(b, false, at, rand)
    })
    expect(hero).toBeGreaterThan(side * 1.4)
  })

  it("「堆着」时它照样堆，落地就停", () => {
    const brass = createBrass()
    heave(brass, true, at, rand)
    expect(brass.pile).toHaveLength(1)
    for (let t = 0; t < 3; t += 1 / 60) stepBrass(brass, 1 / 60)
    expect(brass.pile[0]?.rest).toBe(true)
  })

  it("**它不认「不抛」那一档**：这一档下那一发确实发生了，吞掉就等于撒谎", () => {
    const brass = createBrass()
    heave(brass, false, at, rand)
    expect(brass.flying).toHaveLength(1)
  })
})
