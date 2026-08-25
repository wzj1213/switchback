import { describe, expect, it } from "vitest"
import type { EngineInfo } from "@omni/protocol"
import { petRoster, visibleRoster } from "./pet-roster.js"

const engine = (id: string, state: EngineInfo["state"] = "ok"): EngineInfo => ({
  id,
  label: id.toUpperCase(),
  state,
})

describe("petRoster", () => {
  it("四家真引擎后只加一个不带 engine 的 DSH 占位", () => {
    const roster = petRoster(
      [engine("claude"), engine("codex"), engine("kimi"), engine("grok")],
      "kimi",
    )
    expect(roster.map((slot) => slot.key)).toEqual([
      "claude",
      "codex",
      "kimi",
      "grok",
      "dsh",
    ])
    expect(roster.at(-1)?.engine).toBeUndefined()
    expect(roster.at(-1)?.label).toBe("DSH · 去设置中接入")
  })

  it("当前引擎排在第五位时仍会进入四个真位置", () => {
    const roster = petRoster(
      [engine("claude"), engine("codex"), engine("kimi"), engine("grok"), engine("zcode")],
      "zcode",
    )
    expect(roster.slice(0, 4).map((slot) => slot.engine)).toContain("zcode")
    expect(roster).toHaveLength(5)
  })

  it("DSH 注册并就绪后不再叠一只假占位", () => {
    const roster = petRoster(
      [engine("claude"), engine("codex"), engine("kimi"), engine("grok"), engine("dsh")],
      "claude",
    )
    expect(roster).toHaveLength(5)
    expect(roster.filter((slot) => slot.look.tone === "dsh")).toHaveLength(1)
    expect(roster.at(-1)).toMatchObject({ engine: "dsh", label: "DSH" })
  })

  it("DSH 未安装或当前 profile 不可用时仍画接入占位", () => {
    for (const state of ["missing", "unavailable"] as const) {
      const roster = petRoster([engine("claude"), engine("dsh", state)], "claude")
      expect(roster.at(-1)?.key, state).toBe("dsh")
      expect(roster.at(-1)?.engine, state).toBeUndefined()
    }
  })

  it("占位与真 DSH 共用 DOM key，设置里实时接入时鲸鱼不会跳到左上角", () => {
    const before = petRoster([engine("claude")], "claude").at(-1)
    const after = petRoster([engine("claude"), engine("dsh")], "claude").at(-1)
    expect(before?.key).toBe("dsh")
    expect(after?.key).toBe(before?.key)
  })
})

describe("visibleRoster", () => {
  const all = petRoster(
    [engine("claude"), engine("codex"), engine("kimi"), engine("grok")],
    "kimi",
  )

  it("没藏过就是全员", () => {
    expect(visibleRoster(all, "kimi", []).map((s) => s.key)).toEqual([
      "claude",
      "codex",
      "kimi",
      "grok",
      "dsh",
    ])
  })

  it("藏起来的那几只不出现", () => {
    const keys = visibleRoster(all, "kimi", ["codex", "dsh"]).map((s) => s.key)
    expect(keys).toEqual(["claude", "kimi", "grok"])
  })

  it("当前那家藏不掉——否则台面上没有任何地方画着「谁在答」", () => {
    const keys = visibleRoster(all, "kimi", ["kimi", "codex"]).map((s) => s.key)
    expect(keys).toContain("kimi")
    expect(keys).not.toContain("codex")
  })

  it("只剩一只时留下的是当前那家，不是勾中的那一只", () => {
    // 用户只留了 grok，而这一轮归 kimi：台面上该站 kimi
    const kept = visibleRoster(all, "kimi", ["claude", "codex", "kimi", "dsh"])
    expect(kept.map((s) => s.key)).toEqual(["kimi"])
  })

  it("一只都没留时仍然画当前那家", () => {
    const kept = visibleRoster(all, "grok", ["claude", "codex", "kimi", "grok", "dsh"])
    expect(kept.map((s) => s.key)).toEqual(["grok"])
  })

  it("当前那家根本不在花名册里时，至少留一只，不留空台面", () => {
    expect(visibleRoster(all, "nobody", ["claude", "codex", "kimi", "grok", "dsh"])).toHaveLength(1)
  })
})
