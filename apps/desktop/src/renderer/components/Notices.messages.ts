import { defineMessages } from "@switchback/i18n"

/** 顶部横幅。正文是引擎或宿主报的原话，这里只有徽标与按钮。 */
export const NOTICES = defineMessages(
  {
    crashed: "引擎故障",
    degraded: "能力受限",
    auth: "需要登录",
    egress: "批量外发",
    notice: "引擎提示",
    goTo: (title: string) => `跳到「${title}」`,
    loginTip: "打开 设置 → 安装与接入，在那一家的卡片上登录",
    login: "去登录",
    close: "关闭",
  },
  {
    crashed: "Engine failure",
    degraded: "Limited",
    auth: "Sign-in needed",
    egress: "Bulk upload",
    notice: "Engine notice",
    goTo: (title) => `Go to “${title}”`,
    loginTip: "Opens Settings → Install & connect, where you sign in on that engine's card",
    login: "Sign in",
    close: "Dismiss",
  },
)
