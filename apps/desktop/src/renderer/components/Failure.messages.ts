import { defineMessages } from "@switchback/i18n"

/**
 * 失败卡与轻量报错。报错原话的人话版、属于哪一类，在 `shared/failure.ts`。
 *
 * `hint` 只给少数几类：Switchback 自己手里就有下一步的——额度和限流等不来的时候，换一家引擎接着做
 *（输入框左下角那个选择器就是）。别的类别不给建议——给不出靠得住的，就不说。
 */
export const FAILURE = defineMessages(
  {
    title: {
      quota: "额度用完了",
      rate: "请求太频繁，被限流了",
      auth: "需要重新登录",
      server: "服务端出错了",
      network: "连接断了",
      other: "出错了",
    },
    hint: {
      quota: "等额度恢复，或者在输入框里换一家引擎接着做。",
      rate: "稍等片刻再试，或者在输入框里换一家引擎接着做。",
    },
    details: "详情",
    priorOnce: "在这之前还报过：",
    priorMany: (n: number) => `在这之前还报过 ${String(n)} 次，最后一次：`,
    earlier: "此前：",
    retryTip: "把这一轮你说的那句话原样再发一次",
    retry: "再试一次",
  },
  {
    title: {
      quota: "Out of quota",
      rate: "Too many requests: rate limited",
      auth: "Sign-in needed",
      server: "Server error",
      network: "Connection lost",
      other: "Something went wrong",
    },
    hint: {
      quota: "Wait for the quota to reset, or switch engines from the picker in the input box.",
      rate: "Wait a moment and try again, or switch engines from the picker in the input box.",
    },
    details: "Details",
    priorOnce: "Reported earlier: ",
    priorMany: (n) => `Reported ${String(n)} times earlier. The last one: `,
    earlier: "Earlier:",
    retryTip: "Sends your message from this turn again, as is",
    retry: "Try again",
  },
)
