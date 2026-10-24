import type { Catalog } from "@switchback/i18n"

/** 按记忆规则放行时的理由。规则本身的称呼是它被记下时的语言。（为什么不调 `defineMessages` 见 `redline.messages.ts`。） */
const ZH = { remembered: (describe: string) => `已记忆：${describe}` }

export const DECIDE: Catalog<typeof ZH> = {
  "zh-CN": ZH,
  en: { remembered: (describe) => `Remembered: ${describe}` },
}
