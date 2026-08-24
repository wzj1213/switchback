import { describe, expect, it } from "vitest"
import { enabledEngines, engineEnabled } from "./engine-access.js"

describe("引擎接入开关", () => {
  const cases = [
    { name: "DSH 当前 profile 未确认时隐藏", confirmed: false, id: "dsh", shown: false },
    { name: "DSH 当前 profile 确认后显示", confirmed: true, id: "dsh", shown: true },
    { name: "其他内置引擎不受影响", confirmed: false, id: "codex", shown: true },
    { name: "第三方 ACP 引擎不受影响", confirmed: false, id: "acp:zcode", shown: true },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      const confirmedProfiles = c.confirmed ? ["team"] : ["acp"]
      expect(engineEnabled({ dsh: { profile: "team", confirmedProfiles } }, c.id)).toBe(c.shown)
    })
  }

  it("清单只移走未确认的 DSH，且不改原数组", () => {
    const engines = [{ id: "claude" }, { id: "dsh" }, { id: "acp:zcode" }]
    expect(enabledEngines({ dsh: { profile: "team", confirmedProfiles: ["acp"] } }, engines).map((e) => e.id)).toEqual([
      "claude",
      "acp:zcode",
    ])
    expect(engines).toHaveLength(3)
  })
})
