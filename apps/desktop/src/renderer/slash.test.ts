import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@omni/protocol"
import { applyCommand, matchCommands, slashAt } from "./slash.js"

const cmd = (name: string, description = "", source: SlashCommand["source"] = "engine"): SlashCommand => ({
  name,
  description,
  source,
})

describe("什么时候算在打斜杠命令", () => {
  it("开头打 `/` 就算", () => {
    expect(slashAt("/rev", 4)).toEqual({ start: 0, end: 4, query: "rev" })
  })

  it("刚打下 `/` 也算——那时候该把整张表摊开给人看", () => {
    expect(slashAt("/", 1)).toEqual({ start: 0, end: 1, query: "" })
  })

  it("**句子中间的 `/` 不算**——路径、日期、and/or 里到处都是斜杠", () => {
    expect(slashAt("看一下 src/a.ts", 12)).toBeUndefined()
  })

  it("打了空格就不再是选命令，是在填参数了", () => {
    expect(slashAt("/code-review src/", 17)).toBeUndefined()
  })

  it("空文本不算", () => {
    expect(slashAt("", 0)).toBeUndefined()
  })
})

describe("筛命令", () => {
  const all = [
    cmd("review", "审阅改动"),
    cmd("code-review", "审阅 PR"),
    cmd("new", "新建会话", "omni"),
    cmd("berth-adopt", "berth 收编 · 把项目注册进端口管理"),
  ]

  it("前缀命中排在包含命中前面：打 `re` 时 `review` 该在 `code-review` 之前", () => {
    expect(matchCommands(all, "re").map((c) => c.name)).toEqual(["review", "code-review"])
  })

  it("**说明也参与匹配**——技能名是英文，而人想的是中文", () => {
    expect(matchCommands(all, "收编").map((c) => c.name)).toEqual(["berth-adopt"])
  })

  it("空查询时 omni 自己的排前面——引擎那几十条技能会把它们淹掉", () => {
    expect(matchCommands(all, "")[0]?.name).toBe("new")
  })

  it("一条都不像就给空——面板据此收起来，而不是摊一张全表", () => {
    expect(matchCommands(all, "zzz这不可能有")).toEqual([])
  })

  it("有上限，不会把几十条技能一次全铺出来", () => {
    const many = Array.from({ length: 40 }, (_, i) => cmd(`skill-${String(i)}`))
    expect(matchCommands(many, "skill").length).toBeLessThanOrEqual(12)
  })
})

describe("选中之后输入框里是什么", () => {
  it("补一个空格，光标停在后面——**不直接发出去**，带参数的还等着填", () => {
    expect(applyCommand(cmd("code-review"))).toEqual({ text: "/code-review ", caret: 13 })
  })
})

describe("不该出现在面板里的", () => {
  it("`__` 开头是引擎内部命令——实测 Claude 报过 `__remote-workflow`", () => {
    expect(matchCommands([cmd("__remote-workflow", "内部用的")], "")).toEqual([])
  })

  it("说明以 `(removed)` 开头的是废弃命令，列出来只会让人白点一次", () => {
    expect(matchCommands([cmd("agents", "(removed) Ask Claude to…")], "")).toEqual([])
  })

  it("正常命令不受影响", () => {
    expect(matchCommands([cmd("review", "审阅")], "").map((c) => c.name)).toEqual(["review"])
  })

  it("中文名也能筛：面板上写的是「新建会话」，人自然按它打", () => {
    const c: SlashCommand = { name: "new", label: "新建会话", description: "在当前工作区另开一个", source: "omni" }
    expect(matchCommands([c], "新建").map((x) => x.name)).toEqual(["new"])
  })
})
