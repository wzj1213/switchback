import { defineMessages } from "@switchback/i18n"

/** 审批卡上那句「批准的是什么」。命令、路径、主机原样显示；说不清就说自己说不清。 */
export const CODEX_APPROVE = defineMessages(
  {
    reason: (text: string) => ` （${text}）`,
    noTarget: "目标未送达",
    network: (target: string) => `访问网络 ${target}`,
    noCommand: "执行命令（详情未送达）",
    run: (command: string) => `执行 ${command}`,
    noFiles: "修改文件（详情未送达）",
    edit: (shown: readonly string[], total: number, max: number) =>
      `修改 ${shown.join("、")}${total > max ? ` 等 ${String(total)} 个文件` : ""}`,
  },
  {
    reason: (text) => ` (${text})`,
    noTarget: "target not provided",
    network: (target) => `Access the network: ${target}`,
    noCommand: "Run a command (details not provided)",
    run: (command) => `Run ${command}`,
    noFiles: "Edit files (details not provided)",
    edit: (shown, total, max) => `Edit ${shown.join(", ")}${total > max ? ` and ${String(total - shown.length)} more` : ""}`,
  },
)
