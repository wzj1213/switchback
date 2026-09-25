import { describe, expect, it } from "vitest"
import type { ModelOption } from "@omni/protocol"
import { triggerDetail } from "./ModelPicker.js"

const opus: ModelOption = { id: "opus", label: "Opus", efforts: ["low", "high", "xhigh", "ultracode"], defaultEffort: "high" }
const sonnet: ModelOption = { id: "sonnet", label: "Sonnet", efforts: ["low", "high", "max"] }
const acp: ModelOption = { id: "gpt-5.6-sol[low]", label: "gpt-5.6-sol[low]" }
const models = [opus, sonnet, acp]

describe("模型按钮上那截强度", () => {
  const cases: readonly { name: string; current: ModelOption; level: string | undefined; want: ReturnType<typeof triggerDetail> }[] = [
    { name: "普通档：写人话名，不加重", current: opus, level: "high", want: { text: "高", strong: false } },
    { name: "落在顶档 ultracode：加重", current: opus, level: "ultracode", want: { text: "Ultracode", strong: true } },
    { name: "顶档只是 max 的模型：max 不算贵档", current: sonnet, level: "max", want: { text: "最高", strong: false } },
    { name: "认不出的档位原样写", current: sonnet, level: "turbo", want: { text: "turbo", strong: false } },
    { name: "模型没报 efforts（强度编在 modelId 里）：没有这一截", current: acp, level: "low", want: undefined },
    { name: "报了 efforts 但没有当前档也没有默认档：没有这一截", current: sonnet, level: undefined, want: undefined },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(triggerDetail(models, c.current, c.level)).toEqual(c.want)
    })
  }
})
