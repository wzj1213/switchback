import { defineMessages } from "@switchback/i18n"

/** 换档要重启引擎、却重启不成时说的话。 */
export const TRUST_RESTART = defineMessages(
  {
    notAttached: "权限档重启后会话没有重新接入",
    noHandle: "这条会话没有引擎句柄，无法在保留上下文的前提下重启权限沙箱",
  },
  {
    notAttached: "The thread didn't reattach after restarting for the new trust tier",
    noHandle: "This thread has no engine handle, so its permission sandbox can't be restarted while keeping the context",
  },
)
