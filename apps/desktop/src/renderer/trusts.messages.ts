import { defineMessages } from "@switchback/i18n"

/**
 * 信任档的名字与说明。
 *
 * `hint` 不是可有可无的：这三个词说得出**档位叫什么**，说不出
 * **它到底会不会问我**。而这正是用户在改这个控件时唯一关心的事。
 *
 * ## 为什么现在叫「自动审批 / 完全访问」
 *
 * 用户要的中间档就是 Codex 的 “Approve for me”：越界时先交给引擎自己的评审器，
 * 只有它判成潜在不安全才问人。Claude、Kimi 与 Grok 都对应各自的原生 Auto，
 * 由引擎自己的分类器做后台安全检查。最高档才是 Full Access / YOLO / Bypass 这类最宽权限。
 */
export const TRUSTS = defineMessages(
  {
    label: { "read-only": "只读", "auto-edit": "自动审批", full: "完全访问" },
    hint: {
      "read-only": "只允许读取和只读命令；修改与联网会被拒绝",
      "auto-edit": "优先使用引擎原生安全评审；需要人工决定时才询问",
      full: "最宽权限；允许工作区外操作与联网，通常不再询问",
    },
  },
  {
    label: { "read-only": "Read only", "auto-edit": "Auto-approve", full: "Full access" },
    hint: {
      "read-only": "Reads files and runs read-only commands. Edits and network access are refused.",
      "auto-edit": "The engine's own safety review decides first; you're asked only when a person has to decide.",
      full: "The widest permissions: works outside the workspace and uses the network, usually without asking.",
    },
  },
)
