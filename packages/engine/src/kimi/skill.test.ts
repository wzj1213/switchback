import { describe, expect, it } from "vitest"
import { commandsOf, invocationOf } from "./skill.js"
import type { KimiSkill } from "./wire.js"

const SKILLS: readonly KimiSkill[] = [
  { name: "review", description: "用户审查", source: "user" },
  { name: "write-goal", description: "写目标", source: "builtin" },
  { name: "project-flow", description: "项目流程", source: "project", type: "flow" },
  { name: "background-reference", description: "只供模型读取", source: "builtin", type: "reference" },
]

describe("Kimi skill 命令", () => {
  it("只列可由用户触发的 skill，并沿用 Kimi 的官方命名", () => {
    expect(commandsOf(SKILLS)).toEqual([
      { name: "write-goal", description: "写目标", source: "engine", scope: "system" },
      { name: "skill:project-flow", description: "项目流程", source: "engine", scope: "project" },
      { name: "skill:review", description: "用户审查", source: "engine", scope: "user" },
    ])
  })

  it("只把清单里真实存在的命令还原成原生 skill 名和参数", () => {
    const cases = [
      { text: "/write-goal 新目标", want: { name: "write-goal", args: "新目标" } },
      { text: "/skill:review --fix\nall", want: { name: "review", args: "--fix\nall" } },
      { text: "/skill:project-flow", want: { name: "project-flow" } },
      { text: "/review", want: undefined },
      { text: "/background-reference", want: undefined },
      { text: "/goal status", want: undefined },
      { text: "普通消息", want: undefined },
    ] as const
    for (const row of cases) expect(invocationOf(SKILLS, row.text)).toEqual(row.want)
  })
})
