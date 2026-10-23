import { defineMessages } from "@switchback/i18n"

/** 回答正文里的链接。 */
export const MESSAGE_LINK = defineMessages(
  { unsupported: "此链接暂不支持打开", preview: (where: string) => `预览文件 · ${where}` },
  { unsupported: "This link can't be opened yet", preview: (where) => `Preview file · ${where}` },
)
