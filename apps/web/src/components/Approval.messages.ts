import { defineMessages } from "@switchback/i18n"

/** 对话流里的审批卡。请求原因和命令是引擎报的，不翻译。 */
export const APPROVAL = defineMessages(
  {
    scope: { once: "就这次", session: "本会话都允许" },
    allowed: "已允许",
    denied: "已拒绝",
    expired: "已失效",
    confirm: "需要你确认",
    scopes: "记住这次决定的范围",
    deny: "拒绝",
    allow: "允许",
    offline: "没连上 Switchback，先等重连——它那头还在等你。",
  },
  {
    scope: { once: "Just this once", session: "For this whole thread" },
    allowed: "Allowed",
    denied: "Denied",
    expired: "Expired",
    confirm: "Needs your approval",
    scopes: "How long to remember this decision",
    deny: "Deny",
    allow: "Allow",
    offline: "Not connected to Switchback. Wait for it to reconnect; the engine is still waiting on you.",
  },
)
