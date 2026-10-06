import type { Item } from "@switchback/protocol"

/** 四档原生提示，供远程端真实 CSS 出图与无障碍验收。 */
export const WEB_NOTICES: readonly Item[] = [
  { id: "i-note-info", turnId: "u-1", kind: "notice", at: 1_760_000_000_007,
    message: "Claude 正在准备原生命令。", level: "info" },
  { id: "i-note-notice", turnId: "u-1", kind: "notice", at: 1_760_000_000_008,
    message: "项目 hook 已加载；输出保持为纯文本。", level: "notice" },
  { id: "i-note-suggestion", turnId: "u-1", kind: "notice", at: 1_760_000_000_009,
    message: "建议先提交当前改动，再运行下一条命令。", level: "suggestion" },
  { id: "i-note-warning", turnId: "u-1", kind: "notice", at: 1_760_000_000_010,
    message: "Operation stopped by hook\n这行很长，用来确认手机窄屏会换行而不是撑破会话列。", level: "warning" },
]
