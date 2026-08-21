import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@omni/protocol"
import { promptPlaceholder } from "./prompt-textarea.js"

const command = (argumentHint?: string): SlashCommand => ({
  name: "skill:log-analyzer",
  description: "Analyze service logs",
  source: "engine",
  ...(argumentHint === undefined ? {} : { argumentHint }),
})

describe("promptPlaceholder", () => {
  const cases: readonly {
    name: string
    selected: SlashCommand | undefined
    want: string
  }[] = [
    {
      name: "沿用引擎给出的参数格式",
      selected: command("<service> [--since <time>]"),
      want: "<service> [--since <time>]",
    },
    { name: "引擎没有 schema 时只提示参数可选", selected: command(), want: "输入参数（可选）" },
    {
      name: "没有选择命令时恢复普通任务提示",
      selected: undefined,
      want: "交代任务…（@ 引用文件，/ 用命令）",
    },
  ]

  for (const row of cases) {
    it(row.name, () => {
      expect(
        promptPlaceholder({
          command: row.selected,
          starting: false,
          steering: false,
          queueing: false,
          detached: false,
        }),
      ).toBe(row.want)
    })
  }
})
