import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@switchback/protocol"
import { takeCommand } from "./ComposerAction.js"

describe("选中斜杠命令只换掉命令片段本身", () => {
  const cases: readonly { name: string; command: SlashCommand; want: { text: string; command?: string; switchback?: string } }[] = [
    {
      name: "引擎命令：后面那段话留着当参数",
      command: { name: "review", description: "审查", source: "engine" },
      want: { text: "帮我把这个报错修了", command: "review" },
    },
    {
      name: "Switchback 自己的动作：后面那段话照样留在输入框",
      command: { name: "export", description: "导出", source: "switchback" },
      want: { text: "帮我把这个报错修了", switchback: "export" },
    },
  ]
  for (const one of cases) {
    it(one.name, () => {
      const seen: { text?: string; command?: string; switchback?: string } = {}
      takeCommand(one.command, "帮我把这个报错修了", {
        setText: (text) => { seen.text = text },
        setCommand: (command) => { if (command !== undefined) seen.command = command.name },
        onSwitchback: (name) => { seen.switchback = name },
      })
      expect(seen).toEqual(one.want)
    })
  }
})
