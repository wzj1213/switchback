import { defineMessages } from "@switchback/i18n"

/** 侧栏列表的翻页。`label` 是翻的是什么（「会话」「搜索结果」），由调用方按语言给。 */
export const SIDEBAR_PAGES = defineMessages(
  {
    group: (label: string) => `${label}翻页`,
    prevOf: (label: string) => `上一页${label}`,
    nextOf: (label: string) => `下一页${label}`,
    prev: "上一页",
    next: "下一页",
  },
  {
    group: (label) => `Pages of ${label}`,
    prevOf: (label) => `Previous page of ${label}`,
    nextOf: (label) => `Next page of ${label}`,
    prev: "Previous",
    next: "Next",
  },
)
