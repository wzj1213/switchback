import { defineMessages } from "@switchback/i18n"

/** 模型与推理强度选择器。模型名与说明是引擎报的，不翻译；强度档的名字是 Switchback 起的。 */
export const MODEL_PICKER = defineMessages(
  {
    model: "模型",
    effortTitle: "推理强度",
    reset: "恢复默认设置",
    effort: { low: "轻度", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "超高", ultracode: "Ultracode" },
    effortNote: { ultra: "更快消耗使用额度", ultracode: "xhigh ＋ 工作流编排，更快消耗使用额度" },
    switchTip: (label: string) => `现在就把原生会话切到 ${label}；不会自动发送内容。换完就能挑它自己报的模型`,
    switchFirst: (label: string) => `切到 ${label} 再选模型`,
  },
  {
    model: "Model",
    effortTitle: "Reasoning level",
    reset: "Restore defaults",
    effort: { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", ultracode: "Ultracode" },
    effortNote: { ultra: "Uses up your quota faster", ultracode: "xhigh + workflow orchestration; uses up your quota faster" },
    switchTip: (label) => `Switch the native session to ${label} now. Nothing is sent. Then you can pick from the models it reports.`,
    switchFirst: (label) => `Switch to ${label} to pick a model`,
  },
)
