import { describe, expect, it } from "vitest"
import { createFx, handOf, muzzleOf, stepFx, tapeAt, type FxInput, type FxWorld } from "./pet-fx.js"
import type { Pet } from "./pets.js"

const pet: Pet = { x: 400, y: 120, vx: 0, vy: 0, spin: 0, mode: "rest" }

/** 固定随机源：这一层不含随机，所以测试完全确定。 */
const rand = (): number => 0.5

const input = (over: Partial<FxInput> = {}): FxInput => ({
  pet,
  rate: 0,
  busyHands: false,
  // 默认「不在跑、上下文很空」＝**没有压力**，于是这些用例里一只怪都不会来，
  // 火力那几条才量得准。刷怪单独在下面那组里测
  running: false,
  ratio: 0,
  left: 0,
  foes: true,
  rand,
  ...over,
})

/**
 * 跑 `secs` 秒。**原地改**，返回的就是传进来那个世界——
 * `stepFx` 本来就是这样（见它的注释）。要分支就各起一个世界，别从同一个分叉。
 */
function run(w: FxWorld, secs: number, over: Partial<FxInput> = {}): FxWorld {
  for (let t = 0; t < secs; t += 1 / 60) stepFx(w, 1 / 60, input(over))
  return w
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
    const w = createFx()
    stepFx(w, 1 / 60, input({ rate: 200 }))
    expect(w.bullets).toHaveLength(0)
    expect(w.gun.arm).toBeLessThan(0.55)
  })

  it("手里要换别的东西时立刻停火并收枪", () => {
    const w = run(createFx(), 3, { rate: 120 })
    const drawn = w.gun.arm // 先记下来：run 是原地改的，w 就是同一个世界
    run(w, 1.5, { rate: 120, busyHands: true })
    expect(w.gun.arm).toBeLessThan(drawn)
    expect(w.bullets).toHaveLength(0)
  })

  it("静默之后纸带会清空——「不动了」这一刻必须到得了", () => {
    const shot = run(createFx(), 3, { rate: 120 })
    expect(shot.tape.length).toBeGreaterThan(0)
    const quiet = run(shot, 12)
    expect(quiet.tape).toHaveLength(0)
    expect(quiet.moving).toBe(false)
  })

  it("巨大的 dt 不会一帧发散——切后台再回来是常态", () => {
    const w = createFx()
    for (let i = 0; i < 200; i++) stepFx(w, 4, input({ rate: 200 }))
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

describe("刷怪", () => {
  it("引擎顺的时候一只都不来", () => {
    const w = run(createFx(), 20, { rate: 180, running: true })
    expect(w.foes).toHaveLength(0)
  })

  it("静默久了会有东西爬过来", () => {
    const w = run(createFx(), 20, { rate: 0, running: true })
    expect(w.foes.length).toBeGreaterThan(0)
    expect(w.foes[0]?.kind).toBe("slime")
  })

  it("上下文快满时来的是胖子，哪怕这一轮没在跑", () => {
    const w = run(createFx(), 20, { rate: 0, running: false, ratio: 0.95 })
    expect(w.foes[0]?.kind).toBe("glut")
  })

  it("有东西过来就瞄它，不再对着纸带打", () => {
    const w = run(createFx(), 20, { rate: 0, running: true })
    expect(w.foes.length).toBeGreaterThan(0)
    const before = w.tape.length
    // 只跑一小段：**怪还活着的这段时间里**子弹全打在它身上，纸带不该变长
    run(w, 0.3, { rate: 180, running: true })
    expect(w.tape.length).toBeLessThanOrEqual(before)
  })

  it("火力够就清得掉，火力不够就被摸到脸上——这不是平衡，是事实", () => {
    // **两条支线各起一个世界**：stepFx 是原地改的，从同一个分叉会互相改对方的数组
    const fast = run(createFx(), 20, { rate: 0, running: true })
    const slow = run(createFx(), 20, { rate: 0, running: true })
    run(fast, 8, { rate: 400, running: true })
    run(slow, 8, { rate: 0, running: true })
    expect(fast.bites).toBeLessThan(slow.bites)
  })

  it("压力消失又出现时不会当场蹦一只——那一刻才刚开始不顺", () => {
    const w = run(createFx(), 40, { rate: 200, running: true })
    run(w, 1.5, { rate: 0, running: true })
    expect(w.foes).toHaveLength(0)
  })
})

describe("压力显形的开关", () => {
  it("关掉之后一只都不刷，但打纸带那一层照常", () => {
    const w = run(createFx(), 20, { rate: 0, running: true, foes: false })
    expect(w.foes).toHaveLength(0)
    run(w, 2, { rate: 180, running: true, foes: false })
    expect(w.tape.length).toBeGreaterThan(0)
  })
})
