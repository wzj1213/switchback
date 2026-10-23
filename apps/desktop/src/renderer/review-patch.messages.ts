import { defineMessages } from "@switchback/i18n"

/** 复制一份拿不出文本补丁的改动时，剪贴板里的那句说明。 */
export const REVIEW_PATCH = defineMessages(
  {
    skip: {
      binary: "（二进制文件不提供文本补丁）",
      large: "（补丁过大，请在外部 Git 工具中查看）",
      gone: "（文件已不存在，无法生成当前补丁）",
      failed: "（读取当前净补丁失败）",
    },
    none: "（当前没有可复制的净改动）",
  },
  {
    skip: {
      binary: "(Binary file; no text patch)",
      large: "(The patch is too large; view it in a Git tool)",
      gone: "(The file no longer exists, so there's no current patch)",
      failed: "(Couldn't read the current net patch)",
    },
    none: "(No net changes to copy)",
  },
)
