import { defineMessages } from "@switchback/i18n"

/** 「跑完了叫我一声」那颗开关，以及浏览器给不了推送时的原因（`push.ts` 只报原因码）。 */
export const PUSH_TOGGLE = defineMessages(
  {
    why: {
      insecure: "这个地址不是 https，浏览器不给推送",
      "no-worker": "这个浏览器没有 service worker",
      "no-push": "这个浏览器不支持 Web Push",
      "no-notification": "这个浏览器不支持通知",
      "ios-tab": "iPhone 上要先「分享 → 添加到主屏幕」，标签页里收不到推送",
    },
    refused: "你拒绝了通知权限。浏览器不会再问第二次，要开得去系统设置里改。",
    noKey: "Switchback 没给出推送公钥",
    badSubscription: "浏览器给的订阅缺字段",
    notSaved: (status: number) => `Switchback 没存下这个订阅（HTTP ${String(status)}）`,
    failed: "开不起来",
    denied: "通知权限被拒过了，浏览器不会再问——要开得去系统设置里改。",
    off: "关掉通知",
    on: "跑完了叫我一声",
  },
  {
    why: {
      insecure: "This address isn't https, so the browser won't allow push notifications",
      "no-worker": "This browser doesn't support service workers",
      "no-push": "This browser doesn't support Web Push",
      "no-notification": "This browser doesn't support notifications",
      "ios-tab": "On iPhone, first tap Share → Add to Home Screen. A browser tab can't receive push notifications.",
    },
    refused: "You declined notification permission. The browser won't ask again; to turn it on, change it in system settings.",
    noKey: "Switchback didn't provide a push key",
    badSubscription: "The browser's subscription is missing fields",
    notSaved: (status) => `Switchback didn't save this subscription (HTTP ${String(status)})`,
    failed: "Couldn't turn it on",
    denied: "Notification permission was declined, and the browser won't ask again. To turn it on, change it in system settings.",
    off: "Turn off notifications",
    on: "Notify me when it's done",
  },
)
