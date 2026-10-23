import { defineMessages } from "@switchback/i18n"

/** 侧栏底部：账号与设置。 */
export const SIDEBAR_FOOT = defineMessages(
  {
    settings: "设置",
    account: "账号操作",
    diagnose: "导出诊断报告",
    remain: (n: number) => `剩余 ${String(n)}%`,
  },
  {
    settings: "Settings",
    account: "Account",
    diagnose: "Export diagnostic report",
    remain: (n) => `${String(n)}% left`,
  },
)
