import { defineMessages } from "@switchback/i18n"

/** 已接的那几家：条目没了、试接没过、登录方式变了。 */
export const ACP_ENGINES = defineMessages(
  {
    gone: (file: string) => `${file} 里已经没有这一条了，重新打开这一页看看。`,
    trialFailed: "试接失败，没法登录。",
    noMethod: "它这一次没有报这种登录方式了。点「试接」重新看看它现在认哪几种。",
  },
  {
    gone: (file) => `${file} no longer has this entry. Reopen this page to check.`,
    trialFailed: "The trial failed, so it can't sign in.",
    noMethod: "It didn't report this sign-in method this time. Click “Try” to see which ones it accepts now.",
  },
)
