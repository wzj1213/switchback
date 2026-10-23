import { defineMessages } from "@switchback/i18n"

/** 选中回答里一段字之后浮出来的「问一句」。`prefill` 是填进输入框的开头，发不发、怎么改由你。 */
export const ASK_FLOAT = defineMessages(
  { prefill: (quote: string) => `关于「${quote}」：`, ask: "✦ 问一句" },
  { prefill: (quote) => `About “${quote}”: `, ask: "✦ Ask about this" },
)
