import { defineMessages } from "@switchback/i18n"

/** 复制按钮的三种状态。 */
export const COPY_FEEDBACK = defineMessages(
  {
    label: { idle: "复制", copied: "已复制", failed: "复制失败" },
    copied: "内容已复制",
    failed: "复制失败，请重试",
  },
  {
    label: { idle: "Copy", copied: "Copied", failed: "Copy failed" },
    copied: "Copied",
    failed: "Couldn't copy. Try again.",
  },
)
