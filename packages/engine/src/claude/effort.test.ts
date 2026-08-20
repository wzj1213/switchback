import { describe, expect, it } from "vitest"
import { applyEffort, withEfforts } from "./effort.js"

const M = { id: "sonnet", label: "Sonnet" }

describe("Claude 的强度档从模型自己那儿来", () => {
  it("**实测的字段名**：supportsEffort + supportedEffortLevels", () => {
    const out = withEfforts(M, { supportsEffort: true, supportedEffortLevels: ["low", "high", "max"] })
    expect(out.efforts).toEqual(["low", "high", "max"])
  })

  it("**不支持强度的模型一档都不给**——给了就是一个改了不生效的控件", () => {
    expect(withEfforts(M, { supportsEffort: false, supportedEffortLevels: ["low"] }).efforts).toBeUndefined()
    expect(withEfforts(M, {}).efforts).toBeUndefined()
  })

  it("**说支持却给了空清单，也整条不挂**——空的强度选择器比没有更糟：看起来能选，点开是空的", () => {
    expect(withEfforts(M, { supportsEffort: true, supportedEffortLevels: [] }).efforts).toBeUndefined()
    expect(withEfforts(M, { supportsEffort: true }).efforts).toBeUndefined()
  })

  it("原来那条模型的其余字段一个不改", () => {
    const out = withEfforts({ ...M, description: "d" }, { supportsEffort: true, supportedEffortLevels: ["low"] })
    expect(out.id).toBe("sonnet")
    expect(out.description).toBe("d")
  })
})

describe("把强度设下去", () => {
  it("设成了就回真正生效的那一档", async () => {
    const seen: unknown[] = []
    const query = { applyFlagSettings: (s: unknown) => { seen.push(s); return Promise.resolve() } }
    expect(await applyEffort(query, "xhigh")).toBe("xhigh")
    expect(seen).toEqual([{ effortLevel: "xhigh" }])
  })

  it("没给强度就不发那一发", async () => {
    const seen: unknown[] = []
    const query = { applyFlagSettings: (s: unknown) => { seen.push(s); return Promise.resolve() } }
    expect(await applyEffort(query, undefined)).toBeUndefined()
    expect(await applyEffort(query, "")).toBeUndefined()
    expect(seen).toEqual([])
  })

  it("**这个 SDK 没有这条路时安静跳过**，不抛——版本会变，界面不该因此崩", async () => {
    expect(await applyEffort({}, "high")).toBeUndefined()
    expect(await applyEffort(undefined, "high")).toBeUndefined()
  })

  it("**设失败要抛出去**，由调用方翻成 degraded 并拒绝记录请求值——不能静默当成功", async () => {
    const query = { applyFlagSettings: () => Promise.reject(new Error("nope")) }
    await expect(applyEffort(query, "high")).rejects.toThrow("nope")
  })
})
