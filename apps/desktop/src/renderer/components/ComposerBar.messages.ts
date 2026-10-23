import { defineMessages } from "@switchback/i18n"

/** 输入框下面那一排的选择器。 */
export const COMPOSER_BAR = defineMessages(
  { trust: "信任档", engine: "引擎", missing: "未安装", unavailable: "起不来" },
  { trust: "Trust tier", engine: "Engine", missing: "Not installed", unavailable: "Won't start" },
)
