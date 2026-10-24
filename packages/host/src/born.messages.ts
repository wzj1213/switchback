import { defineMessages } from "@switchback/i18n"

/** 分叉出来的会话标题带上来路，否则侧栏里两条长得一模一样。 */
export const BORN = defineMessages(
  { titled: (title: string, label: string) => `${title}（${label}）` },
  { titled: (title, label) => `${title} (${label})` },
)
