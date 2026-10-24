import { defineMessages } from "@switchback/i18n"

/** agent 没给 title 时审批卡上那句「批准的是什么」。命令、路径、地址原样显示；说不清就说自己说不清。 */
export const ACP_APPROVE = defineMessages(
  {
    noFiles: "修改文件（详情未送达）",
    edit: (shown: readonly string[], total: number, max: number) =>
      `修改 ${shown.join("、")}${total > max ? ` 等 ${String(total)} 个文件` : ""}`,
    run: (command: string) => `执行 ${command}`,
    read: (path: string) => `读取 ${path}`,
    fetch: (url: string) => `访问 ${url}`,
    unknown: (tool: string) => `执行 ${tool}（详情未送达）`,
    nothing: "执行一项操作（详情未送达）",
  },
  {
    noFiles: "Edit files (details not provided)",
    edit: (shown, total, max) => `Edit ${shown.join(", ")}${total > max ? ` and ${String(total - shown.length)} more` : ""}`,
    run: (command) => `Run ${command}`,
    read: (path) => `Read ${path}`,
    fetch: (url) => `Access ${url}`,
    unknown: (tool) => `Run ${tool} (details not provided)`,
    nothing: "Run an action (details not provided)",
  },
)
