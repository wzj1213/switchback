import { describe, expect, it } from "vitest"
import { whenOf } from "./ForeignRow.js"

/**
 * 「codex 历史」那一段是按时间找的（「我昨天在终端里跑的那个」），
 * 所以时间要说人话。
 */
describe("什么时候", () => {
  const now = new Date("2026-08-16T12:00:00Z").getTime()
  const ago = (ms: number): string => whenOf(now - ms, now)

  it("一分钟内说「刚刚」", () => {
    expect(ago(30_000)).toBe("刚刚")
  })

  it("按分、按小时、按天往上走", () => {
    expect(ago(20 * 60_000)).toBe("20 分钟前")
    expect(ago(5 * 3600_000)).toBe("5 小时前")
    expect(ago(3 * 86400_000)).toBe("3 天前")
  })

  it("**超过一周给日期**——「12 天前」还得自己换算一次才知道是哪天", () => {
    expect(ago(12 * 86400_000)).toMatch(/月.*日/)
  })

  it("没有时间戳就不说，别显示成 1970 年", () => {
    expect(whenOf(0, now)).toBe("")
  })
})
