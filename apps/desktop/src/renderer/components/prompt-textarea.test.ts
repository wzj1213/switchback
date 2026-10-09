import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@switchback/protocol"
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
      want: "交代任务…（可拖入文件，@ 搜索，/ 用命令）",
    },
  ]

  it("侧问模式下换成「不进正文」那一句，而且盖过「它还在跑」", () => {
    expect(
      promptPlaceholder({
        command: undefined,
        starting: false,
        steering: false,
        queueing: true,
        aside: true,
      }),
    ).toBe("问一句不进正文的话…（Esc 退回普通发送）")
  })

  it("选了引擎命令时，参数提示仍然优先于侧问", () => {
    expect(
      promptPlaceholder({
        command: command("<service>"),
        starting: false,
        steering: false,
        queueing: false,
        aside: true,
      }),
    ).toBe("<service>")
  })

  it("历史会话换成它自己那一句（发出去会怎样）", () => {
    expect(
      promptPlaceholder({
        command: undefined,
        starting: false,
        steering: false,
        queueing: false,
        history: "历史会话：直接发话，会先接回 Codex 原来的会话。",
        aside: false,
      }),
    ).toBe("历史会话：直接发话，会先接回 Codex 原来的会话。")
  })

  for (const row of cases) {
    it(row.name, () => {
      expect(
        promptPlaceholder({
          command: row.selected,
          starting: false,
          steering: false,
          queueing: false,
            aside: false,
        }),
      ).toBe(row.want)
    })
  }
})
