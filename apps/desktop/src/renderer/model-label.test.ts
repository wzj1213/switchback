import { describe, expect, it } from "vitest"
import { triggerLabel } from "./model-label.js"

describe("triggerLabel", () => {
  const cases: readonly { label: string; want: string; why: string }[] = [
    { label: "Default (recommended)", want: "Default", why: "尾括号里是推荐语，不是身份" },
    { label: "Sonnet 4.5（推荐）", want: "Sonnet 4.5", why: "中文括号一样裁" },
    { label: "Opus 4.1  (latest)", want: "Opus 4.1", why: "括号前的空白一起吃掉" },
    { label: "gpt-5.6-sol[low]", want: "gpt-5.6-sol[low]", why: "方括号里是强度，属于身份" },
    { label: "Claude Code", want: "Claude Code", why: "没有括号就原样" },
    { label: "(beta)", want: "(beta)", why: "裁完什么都不剩，宁可不裁" },
    { label: "（预览）", want: "（预览）", why: "中文括号同理" },
    { label: "A (x) (y)", want: "A (x)", why: "只脱一层，宁可少裁" },
    { label: "Model (a) tail", want: "Model (a) tail", why: "括号不在结尾就不动" },
    { label: "", want: "", why: "空字符串原样返回" },
  ]
  it.each(cases)("$label → $want（$why）", ({ label, want }) => {
    expect(triggerLabel(label)).toBe(want)
  })
})
