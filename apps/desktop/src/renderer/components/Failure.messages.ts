import { defineMessages } from "@switchback/i18n"

/** 失败卡与轻量报错。标题、建议与报错原话的人话版在 `shared/failure.ts`。 */
export const FAILURE = defineMessages(
  {
    details: "详情",
    priorOnce: "在这之前还报过：",
    priorMany: (n: number) => `在这之前还报过 ${String(n)} 次，最后一次：`,
    earlier: "此前：",
    retryTip: "把这一轮你说的那句话原样再发一次",
    retry: "再试一次",
  },
  {
    details: "Details",
    priorOnce: "Reported earlier: ",
    priorMany: (n) => `Reported ${String(n)} times earlier. The last one: `,
    earlier: "Earlier:",
    retryTip: "Sends your message from this turn again, as is",
    retry: "Try again",
  },
)
