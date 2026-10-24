import { count, defineMessages } from "@switchback/i18n"

/** 排队等发的那几句。句子是你写的，不翻译。 */
export const QUEUED = defineMessages(
  {
    label: "待发送",
    head: (n: number) => `待发送 ${String(n)}`,
    images: (text: string, n: number) => `${text} · ${String(n)} 张图`,
    take: "取回",
  },
  {
    label: "Queued",
    head: (n) => `Queued ${String(n)}`,
    images: (text, n) => `${text} · ${count(n, "image")}`,
    take: "Take back",
  },
)
