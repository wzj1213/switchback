import { describe, expect, it } from "vitest"
import { limitNotice } from "./limits.js"

describe("额度提示", () => {
  it("**用得少就不出声**——一直摆一根条在那儿，99% 的时间说的是「你还早着呢」", () => {
    expect(limitNotice({ primary: { usedPercent: 30 } })).toBeUndefined()
    expect(limitNotice({ primary: { usedPercent: 74.9 } })).toBeUndefined()
  })

  it("过了阈值才说", () => {
    expect(limitNotice({ primary: { usedPercent: 80 } })?.percent).toBe(80)
  })

  it("**取更紧的那个**：周用了 40%、5 小时用了 95%，该说 5 小时", () => {
    const n = limitNotice({
      primary: { usedPercent: 40, windowDurationMins: 10080 },
      secondary: { usedPercent: 95, windowDurationMins: 300 },
    })
    expect(n?.percent).toBe(95)
    expect(n?.window).toBe("5 小时内")
  })

  it("同样百分比时窗口短的优先——它更近在眼前", () => {
    const n = limitNotice({
      primary: { usedPercent: 90, windowDurationMins: 10080 },
      secondary: { usedPercent: 90, windowDurationMins: 300 },
    })
    expect(n?.window).toBe("5 小时内")
  })

  it("打满了要说清是「停了」，不是「快满了」", () => {
    expect(limitNotice({ primary: { usedPercent: 100 } })?.blocked).toBe(true)
    expect(limitNotice({ primary: { usedPercent: 99 } })?.blocked).toBe(false)
  })

  it("一周说成「本周」，不是「10080 分钟」", () => {
    expect(limitNotice({ primary: { usedPercent: 80, windowDurationMins: 10080 } })?.window).toBe("本周")
  })

  it("**认不出的时长就不说**：说错一个时间窗比不说更糟", () => {
    expect(limitNotice({ primary: { usedPercent: 80 } })?.window).toBeUndefined()
  })

  it("什么都没报过时不出声", () => {
    expect(limitNotice(undefined)).toBeUndefined()
    expect(limitNotice({})).toBeUndefined()
  })
})

describe("打满之后：说什么时候恢复", () => {
  it("**满了才说恢复时刻**——没满的时候你不需要知道窗口什么时候滚动", () => {
    const iso = new Date(1787196555 * 1000).toISOString()
    expect(limitNotice({ primary: { usedPercent: 100, resetsAt: iso } })?.resetsAt).toBeDefined()
    expect(limitNotice({ primary: { usedPercent: 80, resetsAt: iso } })?.resetsAt).toBeUndefined()
  })

  it("满了但报不上重置时刻，就只说满了——不编一个", () => {
    expect(limitNotice({ primary: { usedPercent: 100 } })).toMatchObject({ blocked: true })
    expect(limitNotice({ primary: { usedPercent: 100 } })?.resetsAt).toBeUndefined()
  })

  it("解析不出来的时间戳当作没有", () => {
    expect(limitNotice({ primary: { usedPercent: 100, resetsAt: "这不是时间" } })?.resetsAt).toBeUndefined()
  })

  it("用本机时区表述：codex 自己按美东渲染，那对东八区的人是错的", () => {
    const iso = new Date(1787196555 * 1000).toISOString()
    const said = limitNotice({ primary: { usedPercent: 100, resetsAt: iso } })?.resetsAt
    const at = new Date(iso)
    expect(said).toBe(
      `${String(at.getMonth() + 1)}月${String(at.getDate())}日 ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`,
    )
  })
})
