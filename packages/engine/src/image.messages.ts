import { defineMessages } from "@switchback/i18n"

/** 图片附件读不进来的几种情况。路径原样显示。 */
export const IMAGE = defineMessages(
  {
    format: (path: string) => `不支持的图片格式：${path}`,
    unreadable: (path: string) => `附件读不到：${path}`,
    empty: (path: string) => `附件是空文件：${path}`,
    tooLarge: (path: string) => `附件超过 12 MB：${path}`,
  },
  {
    format: (path) => `Unsupported image format: ${path}`,
    unreadable: (path) => `Can't read the attachment: ${path}`,
    empty: (path) => `The attachment is an empty file: ${path}`,
    tooLarge: (path) => `The attachment is over 12 MB: ${path}`,
  },
)
