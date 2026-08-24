import { describe, expect, it } from "vitest"
import {
  enabledEngines,
  engineEnabled,
  lastEnabledEngine,
  withEngineEnabled,
} from "./engine-access.js"

const access = (confirmed: readonly string[], disabled: readonly string[] = []) => ({
  dsh: { profile: "team", confirmedProfiles: confirmed },
  disabledEngines: disabled,
})

describe("引擎接入开关", () => {
  const cases = [
    { name: "DSH 当前 profile 未确认时隐藏", confirmed: ["acp"], off: [], id: "dsh", shown: false },
    { name: "DSH 当前 profile 确认后显示", confirmed: ["team"], off: [], id: "dsh", shown: true },
    { name: "其他内置引擎默认都在", confirmed: ["acp"], off: [], id: "codex", shown: true },
    { name: "第三方 ACP 引擎默认也在", confirmed: ["acp"], off: [], id: "acp:zcode", shown: true },
    // 用户自己关的那一条**排在探测结论前面**：他关了就是关了
    { name: "关掉的内置引擎不出现", confirmed: ["acp"], off: ["codex"], id: "codex", shown: false },
    { name: "关掉的第三方引擎不出现", confirmed: ["acp"], off: ["acp:zcode"], id: "acp:zcode", shown: false },
    { name: "确认过的 DSH 也能被关掉", confirmed: ["team"], off: ["dsh"], id: "dsh", shown: false },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      expect(engineEnabled(access(c.confirmed, c.off), c.id)).toBe(c.shown)
    })
  }

  it("清单同时移走未确认的 DSH 和用户关掉的那几家，且不改原数组", () => {
    const engines = [{ id: "claude" }, { id: "codex" }, { id: "dsh" }, { id: "acp:zcode" }]
    expect(enabledEngines(access(["acp"], ["codex"]), engines).map((e) => e.id)).toEqual([
      "claude",
      "acp:zcode",
    ])
    expect(engines).toHaveLength(4)
  })
})

describe("切开关", () => {
  // 关掉 DSH **不擦掉**它的原生确认：那记的是另一件事，
  // 擦了的话再打开时用户得重新确认一次，而他什么都没改过
  const cases = [
    { name: "关掉一家就追加进去", disabled: [], id: "grok", on: false, want: ["grok"] },
    { name: "打开一家就摘出来", disabled: ["grok"], id: "grok", on: true, want: [] },
    { name: "重复关不留两条", disabled: ["grok"], id: "grok", on: false, want: ["grok"] },
    { name: "打开没关过的那家是空操作", disabled: ["grok"], id: "kimi", on: true, want: ["grok"] },
  ] as const

  for (const c of cases) {
    it(c.name, () => {
      expect(withEngineEnabled(c.disabled, c.id, c.on)).toEqual(c.want)
    })
  }
})

describe("最后一家", () => {
  const ids = ["claude", "codex", "dsh"]

  it("只剩一家时把它认出来——界面据此把开关变灰", () => {
    expect(lastEnabledEngine(access(["acp"], ["codex"]), ids)).toBe("claude")
  })

  it("还有两家时谁都不锁", () => {
    expect(lastEnabledEngine(access(["acp"], []), ids)).toBeUndefined()
  })

  it("一家都不剩时也不谎报某一家还开着", () => {
    expect(lastEnabledEngine(access(["acp"], ["claude", "codex"]), ids)).toBeUndefined()
  })
})
