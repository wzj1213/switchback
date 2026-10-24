import { defineMessages } from "@switchback/i18n"

/** 顶部横幅的徽标与关闭按钮。正文是引擎或宿主报的原话，不翻译。 */
export const NOTICES = defineMessages(
  {
    crashed: "出错了",
    degraded: "能力受限",
    auth: "需要登录",
    egress: "批量外发",
    notice: "引擎提示",
    dismiss: "知道了",
  },
  {
    crashed: "Engine error",
    degraded: "Limited",
    auth: "Sign-in needed",
    egress: "Bulk upload",
    notice: "Engine notice",
    dismiss: "Dismiss",
  },
)
