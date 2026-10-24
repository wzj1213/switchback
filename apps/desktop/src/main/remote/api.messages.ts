import { defineMessages } from "@switchback/i18n"

/** 配对与推送订阅接口回给手机的话。配对页会把 `error` 原样显示出来。 */
export const REMOTE_API = defineMessages(
  {
    refused: { "wrong-code": "配对码不对或已过期", locked: "配对码试错太多次，先等一分钟" },
    unnamed: "未命名设备",
    tooLarge: "请求体过大",
    badSubscription: "订阅的形状不对",
  },
  {
    refused: { "wrong-code": "The pairing code is wrong or has expired", locked: "Too many wrong codes. Wait a minute first" },
    unnamed: "Unnamed device",
    tooLarge: "The request body is too large",
    badSubscription: "The subscription isn't in the right shape",
  },
)
