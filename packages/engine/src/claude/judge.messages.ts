import { defineMessages } from "@switchback/i18n"

/** 回给 Claude 的拒绝理由。它会读到这几句，审批卡上也看得见。 */
export const CLAUDE_JUDGE = defineMessages(
  {
    planReadOnly: "当前会话是只读档，不能退出 Claude Plan mode；请先由用户切换权限档",
    closed: "会话已经关闭，没有人能确认这次调用，所以没有执行",
    denied: "用户拒绝了这次调用",
  },
  {
    planReadOnly: "This thread is read-only, so it can't exit Claude Plan mode; the user needs to switch the trust tier first",
    closed: "The thread is closed and no one can approve this call, so it wasn't run",
    denied: "The user denied this call",
  },
)
