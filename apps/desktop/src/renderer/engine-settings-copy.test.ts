import { describe, expect, it } from "vitest"
import { settingsCopyOf } from "./engine-settings-copy.js"

/** 说明跟着界面语言走；去它自己那扇门的命令是引擎的，两种语言一个样。 */
describe("引擎设置页那几句说明", () => {
  const cases = [
    {
      id: "codex",
      locale: "zh-CN",
      summary: "账号、沙箱、审批与功能开关仍由 Codex 管；Switchback 保存新会话怎么起。",
      command: "codex login",
    },
    {
      id: "codex",
      locale: "en",
      summary: "Codex still manages accounts, the sandbox, approvals, and feature flags; Switchback keeps how new threads start.",
      command: "codex login",
    },
    {
      id: "acp:zcode",
      locale: "en",
      summary: "This one is connected through engines.json; its own ACP implementation manages capabilities, models, and credentials.",
      command: undefined,
    },
  ] as const
  for (const one of cases) {
    it(`${one.id} · ${one.locale}`, () => {
      const copy = settingsCopyOf(one.id, one.locale)
      expect(copy.summary).toBe(one.summary)
      expect(copy.native?.command).toBe(one.command)
    })
  }
})
