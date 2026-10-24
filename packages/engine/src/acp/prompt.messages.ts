import { defineMessages } from "@switchback/i18n"

/** 发不出去的两种情况。它自己报的错原样放在前面。 */
export const ACP_PROMPT = defineMessages(
  {
    notReady: (id: string) => `${id} 会话尚未就绪`,
    reviveFailed: (message: string, why: string) => `${message}（重新挂上也失败了：${why}）`,
  },
  {
    notReady: (id) => `The ${id} thread isn't ready yet`,
    reviveFailed: (message, why) => `${message} (reattaching failed too: ${why})`,
  },
)
