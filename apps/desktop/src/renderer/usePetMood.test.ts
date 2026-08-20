import { describe, expect, it } from "vitest"
import { actOf, MOODS, pickMood, type Mood } from "./usePetMood.js"

const FALLBACK: Mood = { name: "blink", ms: 130, weight: 1 }
const mood = (name: string): Mood => MOODS.find((m) => m.name === name) ?? FALLBACK

describe("抽一个小动作", () => {
  it("权重铺满 0~1，两头都抽得出东西来", () => {
    expect(pickMood(0).name).toBe(MOODS[0]?.name)
    expect(pickMood(0.9999).name).toBe(MOODS[MOODS.length - 1]?.name)
  })

  it("越界的 roll 也得给一个动作——排班表不该因为一次浮点误差断掉", () => {
    expect(pickMood(-1)).toBeDefined()
    expect(pickMood(2)).toBeDefined()
    expect(pickMood(Number.NaN)).toBeDefined()
  })

  it("眨眼占大头：它是「这东西是活的」的底噪，别的都是「发生了一件事」", () => {
    const blink = MOODS.find((m) => m.name === "blink")?.weight ?? 0
    const rest = MOODS.filter((m) => m.name !== "blink").reduce((s, m) => s + m.weight, 0)
    expect(blink).toBeGreaterThan(rest / 2)
  })
})

describe("这一轮演给谁看", () => {
  it("一只闲着的都没有就不演——都在飞的时候叠动画会和物理层打架", () => {
    expect(actOf([], mood("blink"), 0.5)).toBeUndefined()
  })

  it("单只的动作落在闲着的那几只里", () => {
    const act = actOf([1, 3], mood("stretch"), 0.9)
    expect(act?.targets).toHaveLength(1)
    expect([1, 3]).toContain(act?.targets[0]?.index)
    expect(act?.targets[0]?.cls).toBe("pet--stretch")
  })

  it("对视：挑挨着的两只，左边那只往右看、右边那只往左看", () => {
    const act = actOf([0, 1, 2], mood("glance"), 0)
    expect(act?.targets).toEqual([
      { index: 0, cls: "pet--look-r" },
      { index: 1, cls: "pet--look-l" },
    ])
  })

  it("凑不出相邻的一对就退回眨眼，不硬凑一次「隔空对视」", () => {
    const act = actOf([0, 2], mood("glance"), 0.5)
    expect(act?.targets).toHaveLength(1)
    expect(act?.targets[0]?.cls).toBe("pet--blink")
  })
})
