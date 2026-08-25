import { describe, expect, it } from "vitest"
import { homeOf, measured, reseat, sameSeats, type Seat } from "./pet-seats.js"
import { resting } from "./usePets.js"
import type { Pet } from "./pets.js"

const seat = (key: string): Seat => ({ key, gait: "hop" })
const at = (x: number, y: number, mode: Pet["mode"] = "rest"): Pet => ({
  ...resting(),
  x,
  y,
  mode,
})

describe("sameSeats", () => {
  const cases: readonly { name: string; a: readonly Seat[]; b: readonly Seat[]; same: boolean }[] = [
    { name: "一模一样", a: [seat("kimi")], b: [seat("kimi")], same: true },
    { name: "少了一个", a: [seat("kimi"), seat("claude")], b: [seat("kimi")], same: false },
    {
      name: "**长度一样但换了人**——上一版只比长度，这一条就是它漏掉的那个",
      a: [seat("kimi")],
      b: [seat("claude")],
      same: false,
    },
    {
      name: "顺序变了也算变了：窝是按下标排的，换了顺序就得重新走位",
      a: [seat("kimi"), seat("claude")],
      b: [seat("claude"), seat("kimi")],
      same: false,
    },
  ]
  for (const one of cases) {
    it(one.name, () => {
      expect(sameSeats(one.a, one.b)).toBe(one.same)
    })
  }
})

describe("reseat", () => {
  it("还在的原样带过去，新来的留空、走了的丢掉", () => {
    const was = [seat("kimi"), seat("claude")]
    const pets = [at(100, 50), at(200, 50, "air")]
    const next = reseat(was, pets, [seat("claude"), seat("grok")])
    expect(next[0]).toBe(pets[1])
    expect(next[1]).toBeUndefined()
  })

  it("**换掉唯一那一只时它不会继承前一只的位置**——那正是「新会话开在左上角」的反面", () => {
    const next = reseat([seat("kimi")], [at(700, 90)], [seat("claude")])
    expect(next).toHaveLength(1)
    expect(next[0]).toBeUndefined()
  })

  it("正飞在空中的那只不重建：重建会让它瞬移回窝", () => {
    const flying = at(300, 10, "air")
    const next = reseat([seat("kimi")], [flying], [seat("kimi"), seat("claude")])
    expect(next[0]?.mode).toBe("air")
    expect(next[0]?.y).toBe(10)
  })
})

describe("measured", () => {
  it("量不准就不许摆——`homeOf` 在零尺寸台面上给的是屏幕外的左上方", () => {
    expect(measured({ width: 0, height: 0 })).toBe(false)
    expect(measured({ width: 900, height: 120 })).toBe(true)
    // 这一条是上面那句的证据：不挡住的话，脚线会落到 -SIZE
    expect(homeOf(0, 1, 0, { width: 0, height: 0 }).y).toBeLessThan(0)
    expect(homeOf(0, 1, 800, { width: 900, height: 120 }).y).toBeGreaterThan(0)
  })
})
