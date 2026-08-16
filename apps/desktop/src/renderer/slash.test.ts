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

  // 这条原来钉的是反的（「omni 排前面，免得被几十条技能淹掉」）。
  // 反过来是因为那个理由站不住：omni 那几条在界面上**本来就另有入口**，
  // 而技能没有第二扇门。旧规则的真实后果是 22 条技能一条都没露过面
  it("空查询时技能排前面——它们在整个界面里没有别的入口", () => {
    expect(matchCommands(all, "")[0]?.source).toBe("engine")
  })

  it("一条都不像就给空——面板据此收起来，而不是摊一张全表", () => {
    expect(matchCommands(all, "zzz这不可能有")).toEqual([])
  })

  it("有上限，不会把几百条一次全铺出来", () => {
    const many = Array.from({ length: 400 }, (_, i) => cmd(`skill-${String(i)}`))
    expect(matchCommands(many, "skill").length).toBeLessThanOrEqual(100)
  })
})

describe("两节的配额：谁也不许把对方挤没", () => {
  /** 这台机器上的真实数量：codex 报 22 条技能，omni 自己 10 条。 */
  const real = [
    ...Array.from({ length: 22 }, (_, i) => cmd(`skill-${String(i)}`)),
    ...Array.from({ length: 10 }, (_, i) => cmd(`omni-${String(i)}`, "", "omni")),
  ]

  it("**空查询下技能全都在**——上一版 limit=12 被 omni 的 10 条吃掉，22 条技能一条都没露过面", () => {
    const hits = matchCommands(real, "")
    expect(hits.filter((c) => c.source === "engine")).toHaveLength(22)
    expect(hits.filter((c) => c.source === "omni")).toHaveLength(10)
  })

  it("技能排在前面：omni 那几条在界面上另有入口，技能没有第二扇门", () => {
    expect(matchCommands(real, "")[0]?.source).toBe("engine")
  })

  it("扁平返回，且同一节的连在一起——分节的界线靠相邻两条 source 变化看出来", () => {
    const sources = matchCommands(real, "").map((c) => c.source)
    expect(sources.indexOf("omni")).toBe(sources.lastIndexOf("engine") + 1)
  })

  it("技能多到装不下时，omni 也保得住底——不会反过来被挤没", () => {
    const many = [
      ...Array.from({ length: 300 }, (_, i) => cmd(`skill-${String(i)}`)),
      ...Array.from({ length: 10 }, (_, i) => cmd(`omni-${String(i)}`, "", "omni")),
    ]
    const hits = matchCommands(many, "")
    expect(hits.filter((c) => c.source === "omni").length).toBeGreaterThanOrEqual(4)
    expect(hits).toHaveLength(100)
  })

  it("一边为空时另一边吃满，不浪费配额", () => {
    const only = Array.from({ length: 150 }, (_, i) => cmd(`skill-${String(i)}`))
    expect(matchCommands(only, "")).toHaveLength(100)
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
