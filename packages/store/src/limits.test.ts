import { describe, expect, it } from "vitest"
import type { RateLimits } from "@omni/protocol"
import { mergeRateLimits } from "./limits.js"

const primary = { usedPercent: 20, windowDurationMins: 10_080 }
const secondary = { usedPercent: 80, windowDurationMins: 300 }

const cases: readonly {
  name: string
  before: RateLimits | undefined
  patch: RateLimits
  expected: RateLimits
}[] = [
  { name: "第一帧直接采用", before: undefined, patch: { primary }, expected: { primary } },
  {
    name: "稀疏帧保留另一窗口",
    before: { primary },
    patch: { secondary },
    expected: { primary, secondary },
  },
  {
    name: "同名窗口由新帧替换",
    before: { primary, secondary },
    patch: { primary: { usedPercent: 30 } },
    expected: { primary: { usedPercent: 30 }, secondary },
  },
  { name: "空对象清掉全部旧值", before: { primary, secondary }, patch: {}, expected: {} },
]

describe("额度稀疏合并", () => {
  it.each(cases)("$name", ({ before, patch, expected }) => {
    expect(mergeRateLimits(before, patch)).toEqual(expected)
  })
})
