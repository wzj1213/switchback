import { describe, expect, it } from "vitest"
import { hitFoe, nearest, nextGap, pressureOf, spawnFoes, stepFoes, type Foe } from "./pet-foes.js"

const rand = (): number => 0.5
const quiet = { running: true, rate: 0, quiet: 0, ratio: 0 }

describe("pressureOf", () => {
  it("引擎跑得好好的时候一只都不来——敌人是压力，不是关卡内容", () => {
    expect(pressureOf({ running: true, rate: 180, quiet: 0, ratio: 0.3 })).toBeUndefined()
  })

  it("不在跑就没有压力：它只是在等你说话", () => {
    expect(pressureOf({ running: false, rate: 0, quiet: 60, ratio: 0.3 })).toBeUndefined()
  })

  it("静默久了来史莱姆，越久来得越勤", () => {
    const early = pressureOf({ ...quiet, quiet: 4 })
    const late = pressureOf({ ...quiet, quiet: 20 })
    expect(early?.kind).toBe("slime")
    expect(late?.level).toBeGreaterThan(early?.level ?? 1)
    expect(nextGap(late?.level ?? 0)).toBeLessThan(nextGap(early?.level ?? 1))
  })

  it("低流速来蜂群——越慢越凶，那正是被限流的体感", () => {
    const slowish = pressureOf({ ...quiet, rate: 35 })
    const crawling = pressureOf({ ...quiet, rate: 3 })
    expect(slowish?.kind).toBe("swarm")
    expect(crawling?.level).toBeGreaterThan(slowish?.level ?? 1)
  })

  it("上下文逼近上限来胖子，而且盖过其他一切——它是最硬的那条", () => {
    expect(pressureOf({ running: false, rate: 200, quiet: 0, ratio: 0.9 })?.kind).toBe("glut")
  })
})

describe("spawnFoes", () => {
  it("蜂群一来一簇，史莱姆一次一只", () => {
    const one: Foe[] = []
    spawnFoes(one, "slime", { from: 0, ground: 100 }, rand)
    expect(one).toHaveLength(1)
    const pack: Foe[] = []
    spawnFoes(pack, "swarm", { from: 0, ground: 100 }, rand)
    expect(pack.length).toBeGreaterThan(3)
  })

  it("有上限，但到顶时是少放几只而不是不放——围攻那一刻不该最安静", () => {
    const foes: Foe[] = []
    for (let i = 0; i < 20; i++) spawnFoes(foes, "swarm", { from: 0, ground: 100 }, rand)
    expect(foes.length).toBeLessThanOrEqual(8)
    expect(foes.length).toBeGreaterThan(0)
  })

  it("每只走得略有不同，不然像一排复制粘贴", () => {
    const foes: Foe[] = []
    let n = 0
    spawnFoes(foes, "swarm", { from: 0, ground: 100 }, () => ((n++ % 7) + 1) / 8)
    expect(new Set(foes.map((f) => f.speed)).size).toBeGreaterThan(1)
  })
})

describe("hitFoe", () => {
  it("伤害恒为 1——火力靠射速表达，不靠每发的大小", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "slime", { from: 0, ground: 100 }, rand)
    const f = foes[0] as Foe
    hitFoe(f)
    expect(f.hp).toBe(f.hp0 - 1)
    expect(f.knock).toBeGreaterThan(0)
  })

  it("血空了就开始消散，之后再打也不算", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "swarm", { from: 0, ground: 100 }, rand)
    const f = foes[0] as Foe
    for (let i = 0; i < 10; i++) hitFoe(f)
    expect(f.dying).toBeGreaterThan(0)
    const hp = f.hp
    hitFoe(f)
    expect(f.hp).toBe(hp)
  })

  it("胖子比史莱姆经打得多——它对着的那条压力也更难消", () => {
    const a: Foe[] = []
    const b: Foe[] = []
    spawnFoes(a, "slime", { from: 0, ground: 100 }, rand)
    spawnFoes(b, "glut", { from: 0, ground: 100 }, rand)
    expect((b[0] as Foe).hp0).toBeGreaterThan((a[0] as Foe).hp0 * 3)
  })
})

describe("stepFoes", () => {
  it("往右走，走到跟前咬一口然后散掉", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "slime", { from: 100, ground: 50 }, rand)
    const before = (foes[0] as Foe).x
    expect(stepFoes(foes, 0.1, 900)).toBe(0)
    expect((foes[0] as Foe).x).toBeGreaterThan(before)
    ;(foes[0] as Foe).x = 890
    expect(stepFoes(foes, 0.016, 900)).toBe(1)
    expect((foes[0] as Foe).dying).toBeGreaterThan(0)
  })

  it("消散完就从数组里消失——不留尸体，不无限长大", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "slime", { from: 100, ground: 50 }, rand)
    hitFoe(foes[0] as Foe)
    ;(foes[0] as Foe).hp = 0
    ;(foes[0] as Foe).dying = 0.0001
    for (let i = 0; i < 60; i++) stepFoes(foes, 0.016, 9000)
    expect(foes).toHaveLength(0)
  })

  it("死了的那只不再前进，也不算咬人", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "slime", { from: 890, ground: 50 }, rand)
    ;(foes[0] as Foe).dying = 0.0001
    expect(stepFoes(foes, 0.016, 900)).toBe(0)
  })
})

describe("nearest", () => {
  it("瞄最近那只——远的那只还有时间", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "slime", { from: 100, ground: 50 }, rand)
    spawnFoes(foes, "slime", { from: 300, ground: 50 }, rand)
    expect(nearest(foes)?.x).toBeGreaterThan(200)
  })

  it("正在消散的不算目标", () => {
    const foes: Foe[] = []
    spawnFoes(foes, "slime", { from: 100, ground: 50 }, rand)
    spawnFoes(foes, "slime", { from: 300, ground: 50 }, rand)
    ;(foes[1] as Foe).dying = 0.1
    expect(nearest(foes)?.x).toBeLessThan(200)
  })

  it("一只活的都没有就是 undefined", () => {
    expect(nearest([])).toBeUndefined()
  })
})
