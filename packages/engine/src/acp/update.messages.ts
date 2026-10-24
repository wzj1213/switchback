import { defineMessages } from "@switchback/i18n"

/** 引擎自己换档时那一条。档位 id 是引擎报的。 */
export const ACP_UPDATE = defineMessages(
  { modeChanged: (mode: string) => `引擎把档位切到了 ${mode}。` },
  { modeChanged: (mode) => `The engine switched its mode to ${mode}.` },
)
