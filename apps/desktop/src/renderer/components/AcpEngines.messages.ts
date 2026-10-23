import { defineMessages } from "@switchback/i18n"

/** 安装与接入 → 已接入的 ACP 引擎。 */
export const ACP_ENGINES = defineMessages(
  {
    unreadable: "读不到 engines.json。",
    reading: "正在读…",
    none: "还没接过第三方 ACP 引擎。从下面的注册表里挑一家，或者指一个可执行文件。",
  },
  {
    unreadable: "Couldn't read engines.json.",
    reading: "Reading…",
    none: "No third-party ACP engines yet. Pick one from the registry below, or point at an executable.",
  },
)
