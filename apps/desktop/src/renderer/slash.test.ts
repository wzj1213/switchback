import { describe, expect, it } from "vitest"
import type { SlashCommand } from "@switchback/protocol"
import {
  applyCommand,
  commandLabel,
  commandText,
  ghostOf,
  markOf,
  matchCommands,
  slashAt,
} from "./slash.js"

const cmd = (
  name: string,
  description = "",
  source: SlashCommand["source"] = "engine",
): SlashCommand => ({
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
    cmd("new", "新建会话", "switchback"),
    cmd("berth-adopt", "berth 收编 · 把项目注册进端口管理"),
  ]

  it("前缀命中排在包含命中前面：打 `re` 时 `review` 该在 `code-review` 之前", () => {
    expect(matchCommands(all, "re").map((c) => c.name)).toEqual(["review", "code-review"])
  })

  it("**说明也参与匹配**——技能名是英文，而人想的是中文", () => {
    expect(matchCommands(all, "收编").map((c) => c.name)).toEqual(["berth-adopt"])
  })

  // 这条原来钉的是反的（「Switchback 排前面，免得被几十条技能淹掉」）。
  // 反过来是因为那个理由站不住：Switchback 那几条在界面上**本来就另有入口**，
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
  /** 这台机器上的真实数量：codex 报 22 条技能，Switchback 自己 10 条。 */
  const real = [
    ...Array.from({ length: 22 }, (_, i) => cmd(`skill-${String(i)}`)),
    ...Array.from({ length: 10 }, (_, i) => cmd(`switchback-${String(i)}`, "", "switchback")),
  ]

  it("**空查询下技能全都在**——上一版 limit=12 被 Switchback 的 10 条吃掉，22 条技能一条都没露过面", () => {
    const hits = matchCommands(real, "")
    expect(hits.filter((c) => c.source === "engine")).toHaveLength(22)
    expect(hits.filter((c) => c.source === "switchback")).toHaveLength(10)
  })

  it("技能排在前面：Switchback 那几条在界面上另有入口，技能没有第二扇门", () => {
    expect(matchCommands(real, "")[0]?.source).toBe("engine")
  })

  it("扁平返回，且同一节的连在一起——分节的界线靠相邻两条 source 变化看出来", () => {
    const sources = matchCommands(real, "").map((c) => c.source)
    expect(sources.indexOf("switchback")).toBe(sources.lastIndexOf("engine") + 1)
  })

  it("技能多到装不下时，Switchback 也保得住底——不会反过来被挤没", () => {
    const many = [
      ...Array.from({ length: 300 }, (_, i) => cmd(`skill-${String(i)}`)),
      ...Array.from({ length: 10 }, (_, i) => cmd(`switchback-${String(i)}`, "", "switchback")),
    ]
    const hits = matchCommands(many, "")
    expect(hits.filter((c) => c.source === "switchback").length).toBeGreaterThanOrEqual(4)
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

  it("token 显示人话名称，发送时仍还原成引擎原文", () => {
    const skill = cmd("skill:log-analyzer")
    expect(commandLabel(skill)).toBe("Log Analyzer")
    expect(commandText(skill, "  --tail 50 ")).toBe("/skill:log-analyzer --tail 50")
    expect(commandText(skill, "")).toBe("/skill:log-analyzer")
  })

  it("引擎给了 label 就不擅自改写", () => {
    const command = { ...cmd("review"), label: "代码审查" }
    expect(commandLabel(command)).toBe("代码审查")
    expect(commandText(undefined, " 普通消息 ")).toBe("普通消息")
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
    const c: SlashCommand = {
      name: "new",
      label: "新建会话",
      description: "在当前工作区另开一个",
      source: "switchback",
    }
    expect(matchCommands([c], "新建").map((x) => x.name)).toEqual(["new"])
  })
})

describe("名字里打中的那几个字", () => {
  const cases: {
    name: string
    text: string
    query: string
    want: readonly [string, string, string] | undefined
  }[] = [
    { name: "打头的那几个字", text: "/deck", query: "de", want: ["/", "de", "ck"] },
    { name: "中间也算——`/model` 里的 `de`", text: "/model", query: "de", want: ["/mo", "de", "l"] },
    {
      name: "大小写不敏感，但切出来的是原文",
      text: "/DBQuery",
      query: "dbq",
      want: ["/", "DBQ", "uery"],
    },
    { name: "没打中就不指", text: "/deck", query: "zz", want: undefined },
    { name: "还没打字就不指——一进来全表加粗等于没加粗", text: "/deck", query: "", want: undefined },
    { name: "中文名一样能打中", text: "新建会话", query: "会话", want: ["新建", "会话", ""] },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(markOf(c.text, c.query)).toEqual(c.want)
    })
  }
})

describe("光标后面那截灰字", () => {
  const cases: { name: string; command: SlashCommand | undefined; query: string; want: string }[] =
    [
      { name: "补上剩下那半截", command: cmd("deck"), query: "de", want: "ck" },
      { name: "整条打完了就没得补", command: cmd("deck"), query: "deck", want: "" },
      {
        name: "还没打字不猜——那时排第一的只是字母序的巧合",
        command: cmd("deck"),
        query: "",
        want: "",
      },
      { name: "一条候选都没有", command: undefined, query: "de", want: "" },
      {
        name: "大小写对不上就不补：拼出来的 `/dbQuery` 不是任何一条命令",
        command: cmd("DBQuery"),
        query: "db",
        want: "",
      },
      {
        name: "命中在中间的（`/model` 配 `de`）也不补——灰字只能接在后面",
        command: cmd("model"),
        query: "de",
        want: "",
      },
    ]
  for (const c of cases) {
    it(c.name, () => {
      expect(ghostOf(c.command, c.query)).toBe(c.want)
    })
  }
})
