import { defineMessages } from "@switchback/i18n"

/** 设置 → 引擎 → 原生配置与配置来源。 */
export const ENGINE_NATIVE = defineMessages(
  {
    native: "原生配置",
    nativeHint: "认证、Provider 和厂商高级项走它公开的原生入口；常用的新会话偏好在上面直接改。",
    copy: "复制命令",
    sources: "配置来源",
    sourcesHint: "这家引擎自己读的那几份配置。Switchback 只帮你打开，不替它改。",
  },
  {
    native: "Native settings",
    nativeHint: "Sign-in, providers, and vendor options go through the engine's own native entry point; common new-thread preferences are above.",
    copy: "Copy command",
    sources: "Config sources",
    sourcesHint: "The config files this engine reads itself. Switchback only opens them for you; it doesn't change them.",
  },
)
