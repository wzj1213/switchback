import { defineMessages } from "@switchback/i18n"

/** Kimi 没给 action 时审批卡上那句「批准的是什么」。命令、路径、地址原样显示。 */
export const KIMI_APPROVE = defineMessages(
  {
    run: (command: string) => `执行 ${command}`,
    edit: (path: string) => `修改 ${path}`,
    fetch: (url: string) => `访问 ${url}`,
    unknown: (tool: string) => `执行 ${tool}（详情未送达）`,
  },
  {
    run: (command) => `Run ${command}`,
    edit: (path) => `Edit ${path}`,
    fetch: (url) => `Access ${url}`,
    unknown: (tool) => `Run ${tool} (details not provided)`,
  },
)
