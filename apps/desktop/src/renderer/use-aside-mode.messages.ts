import { defineMessages } from "@switchback/i18n"

/** `/侧问` 这条 Switchback 命令。英文版打 `/aside`。 */
export const ASIDE_MODE = defineMessages(
  {
    name: "侧问",
    label: "侧问",
    description: "问一句不进正文的话——答案落在转录区，但不进发给引擎的上下文",
  },
  {
    name: "aside",
    label: "Side question",
    description: "Ask something on the side. The answer shows in the transcript but stays out of the context sent to the engine.",
  },
)
