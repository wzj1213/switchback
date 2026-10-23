import { defineMessages } from "@switchback/i18n"

/** HTML 文件的预览与源码切换。 */
export const PREVIEW_CONTENT = defineMessages(
  { mode: "HTML 查看方式", preview: "预览", source: "源码", frame: (name: string) => `${name} 预览` },
  { mode: "HTML view", preview: "Preview", source: "Source", frame: (name) => `Preview of ${name}` },
)
