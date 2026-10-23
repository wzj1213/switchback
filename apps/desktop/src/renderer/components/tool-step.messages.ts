import { defineMessages } from "@switchback/i18n"

/** 工具阶梯里的一步。动词与状态归 `tool.messages.ts`。 */
export const TOOL_STEP = defineMessages(
  { preview: (path: string) => `在工作台预览\n${path}` },
  { preview: (path) => `Preview in workbench\n${path}` },
)
