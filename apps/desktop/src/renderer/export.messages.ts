import { defineMessages } from "@switchback/i18n"

/** 导出成 Markdown 时的小节名与引用块。 */
export const EXPORT = defineMessages(
  {
    head: (cwd: string, engine: string) => `工作区 \`${cwd}\` · 引擎 ${engine}`,
    you: "你",
    handoff: "历史交接",
    shell: "终端命令",
    goal: "长期目标续跑",
    scheduled: "定时任务",
    plan: "计划",
    approval: (summary: string, status: string, reason: string) => `> **需要确认**：${summary}（${status}）\n> ${reason}`,
    notice: (level: string) => `引擎提示 · ${level}`,
  },
  {
    head: (cwd, engine) => `Workspace \`${cwd}\` · Engine ${engine}`,
    you: "You",
    handoff: "Handoff note",
    shell: "Terminal command",
    goal: "Goal continuation",
    scheduled: "Scheduled task",
    plan: "Plan",
    approval: (summary, status, reason) => `> **Needs approval**: ${summary} (${status})\n> ${reason}`,
    notice: (level) => `Engine notice · ${level}`,
  },
)
