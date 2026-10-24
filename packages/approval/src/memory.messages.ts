import type { Catalog } from "@switchback/i18n"

/** 建议记住的那条规则怎么称呼。记下来以后就用当时的说法。（为什么不调 `defineMessages` 见 `redline.messages.ts`。） */
const ZH = { allowHost: (host: string) => `自动允许访问 ${host}` }

export const MEMORY: Catalog<typeof ZH> = {
  "zh-CN": ZH,
  en: { allowHost: (host) => `Automatically allow access to ${host}` },
}
