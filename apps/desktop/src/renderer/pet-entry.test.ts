import { describe, expect, it } from "vitest"
import { ENTRY_MS, entryOf } from "./pet-entry.js"
import { lookOf } from "./pets.js"

describe("entryOf", () => {
  it("史莱姆砸下来", () => {
    expect(entryOf(lookOf("kimi"))).toBe("drop")
    expect(entryOf(lookOf("grok"))).toBe("drop")
  })

  it("公开版里 Claude 也是史莱姆，砸下来", () => {
    expect(entryOf(lookOf("claude"))).toBe("drop")
    expect(entryOf(lookOf("claude-code"))).toBe("drop")
  })

  it("鲸跃出水面", () => {
    expect(entryOf(lookOf("dsh"))).toBe("splash")
  })

  it("没见过的那一家只是淡进来——它连出场都不编花样", () => {
    // 它也画成史莱姆，但**身份先于形状**：那只 kimi 史莱姆说的是「这家我认识」
    expect(entryOf(lookOf("something-new"))).toBe("fade")
    expect(lookOf("something-new").shape).toBe("slime")
  })
})

describe("ENTRY_MS", () => {
  it("每一种都有时长，且都是正数", () => {
    for (const kind of ["drop", "chute", "splash", "fade"] as const) {
      expect(ENTRY_MS[kind]).toBeGreaterThan(0)
    }
  })

  it("淡入最短、伞投最长——一个是「没有花样」，一个是真的要飘一段", () => {
    expect(ENTRY_MS.fade).toBeLessThan(ENTRY_MS.drop)
    expect(ENTRY_MS.chute).toBeGreaterThan(ENTRY_MS.splash)
  })
})
