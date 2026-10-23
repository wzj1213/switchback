import { defineMessages } from "@switchback/i18n"

/** 转录区里换引擎的那条分界。 */
export const ENGINE_SWITCH = defineMessages(
  { switchTo: (name: string) => `切换至 ${name}`, brief: "· 附交接说明" },
  { switchTo: (name) => `Switched to ${name}`, brief: "· with handoff note" },
)
