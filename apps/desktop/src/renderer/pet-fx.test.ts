import { describe, expect, it } from "vitest"
import { createFx, handOf, muzzleOf, stepFx, tapeAt, type FxInput, type FxWorld } from "./pet-fx.js"
import type { Pet } from "./pets.js"

const pet: Pet = { x: 400, y: 120, vx: 0, vy: 0, spin: 0, mode: "rest" }

/** 固定随机源：这一层不含随机，所以测试完全确定。 */
const rand = (): number => 0.5

const input = (over: Partial<FxInput> = {}): FxInput => ({ pet, rate: 0, busyHands: false, rand, ...over })

function run(w: FxWorld, secs: number, over: Partial<FxInput> = {}): FxWorld {
  let world = w
  for (let t = 0; t < secs; t += 1 / 60) world = stepFx(world, 1 / 60, input(over))
  return world
}

describe("stepFx", () => {
  it("零流速不开火，也不留下任何字", () => {
    const w = run(createFx(), 3)
    expect(w.bullets).toHaveLength(0)
    expect(w.tape).toHaveLength(0)
  })

  it("有流速就抽枪、开火、在纸带上留字", () => {
    const w = run(createFx(), 3, { rate: 120 })
    expect(w.gun.arm).toBeGreaterThan(0.9)
    expect(w.tape.length).toBeGreaterThan(0)
  })

  it("火力恒等于流速：流速翻倍，打出去的发数也翻倍", () => {
    // 比的是**打了多少发**（`ch` 每出一发加一），不是纸带上剩几个字：
    // 纸带的漂速也跟着流速走，所以它长度恒定——快慢体现在它走得多快
    const slow = run(createFx(), 4, { rate: 40 })
    const fast = run(createFx(), 4, { rate: 80 })
    expect(fast.ch / Math.max(1, slow.ch)).toBeGreaterThan(1.7)
    expect(fast.ch / Math.max(1, slow.ch)).toBeLessThan(2.3)
  })

  it("纸带是一条排得开的字，不是堆在一个点上的一团", () => {
    const w = run(createFx(), 4, { rate: 190 })
    const xs = w.tape.map((g) => g.x).sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(6)
    // 相邻两个字之间总得有一个字宽，否则读起来就是一团墨
    for (let i = 1; i < xs.length; i++) {
      expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThan(6)
    }
  })

  it("先抽枪再开打——抽枪那一拍里一发都不出", () => {
    const w = stepFx(createFx(), 1 / 60, input({ rate: 200 }))
    expect(w.bullets).toHaveLength(0)
    expect(w.gun.arm).toBeLessThan(0.55)
  })

  it("手里要换别的东西时立刻停火并收枪", () => {
    const armed = run(createFx(), 3, { rate: 120 })
    const busy = run(armed, 1.5, { rate: 120, busyHands: true })
    expect(busy.gun.arm).toBeLessThan(armed.gun.arm)
    expect(busy.bullets).toHaveLength(0)
  })

  it("静默之后纸带会清空——「不动了」这一刻必须到得了", () => {
    const shot = run(createFx(), 3, { rate: 120 })
    expect(shot.tape.length).toBeGreaterThan(0)
    const quiet = run(shot, 12)
    expect(quiet.tape).toHaveLength(0)
    expect(quiet.moving).toBe(false)
  })

  it("巨大的 dt 不会一帧发散——切后台再回来是常态", () => {
    let w = createFx()
    for (let i = 0; i < 200; i++) w = stepFx(w, 4, input({ rate: 200 }))
    for (const v of [w.gun.x, w.gun.y, w.gun.ang, w.gun.kick, w.acc]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it("落下的字是顺着来的，不是随机的乱码", () => {
    const w = run(createFx(), 3, { rate: 120 })
    const chars = w.tape.map((g) => g.ch)
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i]).toBe((chars[i - 1] ?? 0) + 1)
    }
  })
})

describe("几何", () => {
  it("手在身子左沿外面一点，枪口再从手里往外探", () => {
    const hand = handOf(pet)
    // **在左沿外面**：画布压在桌宠底下，手搁在身体内侧的话整把枪都被盖住
    expect(hand.x).toBeLessThan(pet.x)
    expect(pet.x - hand.x).toBeLessThan(4)
    expect(hand.y).toBeGreaterThan(pet.y)
    const w = run(createFx(), 2, { rate: 120 })
    // 朝左打，所以枪口在手的左边
    expect(muzzleOf(w.gun).x).toBeLessThan(w.gun.x)
  })

  it("纸带在手的左边，左边界更靠左", () => {
    const t = tapeAt(handOf(pet))
    expect(t.x).toBeLessThan(pet.x)
    expect(t.left).toBeLessThan(t.x)
  })
})
