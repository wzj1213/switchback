import { describe, expect, it } from "vitest"
import { echoed, type Picked } from "./use-pick-pending.js"

describe("模型菜单选完之后，引擎的回声对上了没有", () => {
  const cases: readonly { name: string; pick: Picked; model?: string; effort?: string; want: boolean }[] = [
    { name: "模型与强度都对上", pick: { model: "opus", effort: "high" }, model: "opus", effort: "high", want: true },
    { name: "模型对上、强度还是旧的", pick: { model: "opus", effort: "high" }, model: "opus", effort: "low", want: false },
    { name: "模型还是旧的", pick: { model: "opus", effort: "high" }, model: "sonnet", effort: "high", want: false },
    { name: "这次没指定强度：模型对上就算", pick: { model: "opus" }, model: "opus", effort: "low", want: true },
    { name: "引擎拒了强度、记录被清掉：对不上（交给超时）", pick: { model: "opus", effort: "max" }, model: "opus", want: false },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(echoed(c.pick, c.model, c.effort)).toBe(c.want)
    })
  }
})
