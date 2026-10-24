import { defineMessages } from "@switchback/i18n"

/** Claude 从记忆里召回了几条：范围的叫法与那一条提示。路径原样显示。 */
export const CLAUDE_MEMORY = defineMessages(
  {
    scope: { personal: "个人", team: "团队", organization: "组织" },
    recalled: (rows: readonly string[]) => `Claude 已从记忆中召回 ${String(rows.length)} 条：\n${rows.join("\n")}`,
  },
  {
    scope: { personal: "personal", team: "team", organization: "organization" },
    recalled: (rows) => `Claude recalled ${String(rows.length)} from memory:\n${rows.join("\n")}`,
  },
)
