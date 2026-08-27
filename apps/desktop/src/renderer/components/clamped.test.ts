import { describe, expect, it } from "vitest"
import { CLAMP_MAX, needsClamp } from "./clamped.js"

describe("太长的那条要不要收起来", () => {
  it("只高出一点点的不收——那颗按钮点开只多出两行，白让人点一下", () => {
    const cases = [
      [0, false, "还没量出来"],
      [CLAMP_MAX, false, "正好到顶"],
      [CLAMP_MAX + 71, false, "高出的还在余量里"],
      [CLAMP_MAX + 72, false, "正好等于余量，仍然不收"],
      [CLAMP_MAX + 73, true, "超过余量才收"],
      [CLAMP_MAX * 8, true, "粘了一整份日志"],
    ] as const
    for (const [height, want, why] of cases) expect(needsClamp(height), why).toBe(want)
  })

  it("门槛和余量都能改——不同的地方可以有不同的松紧", () => {
    expect(needsClamp(120, 100, 0)).toBe(true)
    expect(needsClamp(120, 100, 20)).toBe(false)
  })
})
