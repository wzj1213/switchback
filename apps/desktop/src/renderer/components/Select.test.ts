import { describe, expect, it } from "vitest"
import { triggerWords } from "./Select.js"

describe("触发器的悬停提示与读屏名", () => {
  const cases: readonly {
    name: string
    input: Parameters<typeof triggerWords>[0]
    want: ReturnType<typeof triggerWords>
  }[] = [
    {
      name: "没给 name（审核范围、设置页那几个）：提示照旧是 title，读屏名还是按钮上的字",
      input: { label: "未提交", title: "选择审核范围" },
      want: { tip: "选择审核范围" },
    },
    { name: "没给 name 也没给 title：提示就是标签", input: { label: "浅色" }, want: { tip: "浅色" } },
    {
      // 输入区收成图标后，当前值只剩这一句看得见
      name: "给了 name：提示和读屏名都先说「名：当前值」",
      input: { name: "引擎", label: "Claude Code" },
      want: { tip: "引擎：Claude Code", spoken: "引擎：Claude Code" },
    },
    {
      name: "强度那截算进当前值",
      input: { name: "模型", label: "Opus", detail: { text: "高", strong: false } },
      want: { tip: "模型：Opus · 高", spoken: "模型：Opus · 高" },
    },
    {
      name: "原来那句说明挪到第二行；读屏名只要名字和值",
      input: { name: "信任档", label: "自动审批", title: "Claude Code 不会把它自己改的档位告诉 Switchback。" },
      want: { tip: "信任档：自动审批\nClaude Code 不会把它自己改的档位告诉 Switchback。", spoken: "信任档：自动审批" },
    },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(triggerWords(c.input, "zh-CN")).toEqual(c.want)
    })
  }
})
