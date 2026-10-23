import { defineMessages } from "@switchback/i18n"

/** 附件缩略图与大图预览。 */
export const IMAGE_THUMB = defineMessages(
  {
    preview: (name: string) => `预览 ${name}`,
    remove: "去掉这个附件",
    lightbox: (name: string) => `图片预览：${name}`,
    close: "关闭图片预览",
    closeTip: "关闭（Esc）",
    opening: "正在打开…",
    broken: (path: string) => `这张图打不开了：${path}`,
  },
  {
    preview: (name) => `Preview ${name}`,
    remove: "Remove attachment",
    lightbox: (name) => `Image preview: ${name}`,
    close: "Close image preview",
    closeTip: "Close (Esc)",
    opening: "Opening…",
    broken: (path) => `This image can't be opened: ${path}`,
  },
)
