import { describe, expect, it } from "vitest"
import { toClaudeLimits } from "./limits.js"

describe("Claude 订阅限额", () => {
  it("只翻译有确定单位与窗口语义的帧", () => {
    const reset = 1_800_000_000
    const cases = [
      {
        name: "五小时分数换成短窗百分比",
        raw: { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.9, resetsAt: reset },
        want: { secondary: { usedPercent: 90, windowDurationMins: 300, resetsAt: new Date(reset * 1000).toISOString() } },
      },
      {
        name: "七日模型桶仍是长窗",
        raw: { status: "rejected", rateLimitType: "seven_day_sonnet", utilization: 1 },
        want: { primary: { usedPercent: 100, windowDurationMins: 10_080 } },
      },
      {
        name: "正常帧没有百分比时清旧告警",
        raw: { status: "allowed", rateLimitType: "five_hour", resetsAt: reset },
        want: {},
      },
      {
        name: "告警帧没百分比不猜",
        raw: { status: "allowed_warning", rateLimitType: "seven_day" },
        want: undefined,
      },
      {
        name: "overage 不是时间窗",
        raw: { status: "allowed", rateLimitType: "overage", utilization: 0.2 },
        want: undefined,
      },
      {
        name: "非法分数不进协议",
        raw: { status: "rejected", rateLimitType: "five_hour", utilization: Number.NaN },
        want: undefined,
      },
    ] as const

    for (const row of cases) expect(toClaudeLimits(row.raw), row.name).toEqual(row.want)
  })
})
