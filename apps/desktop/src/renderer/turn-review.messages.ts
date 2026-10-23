import { defineMessages } from "@switchback/i18n"

/** 引擎报的一次编辑拿不出差异时，审核面板上那句话。 */
export const TURN_REVIEW = defineMessages(
  {
    noPatch: "引擎记录了这次编辑，但没有提供补丁内容。",
    tooLarge: "这份编辑记录过大，无法在面板中完整显示。",
    empty: "这次编辑没有文本差异。",
  },
  {
    noPatch: "The engine recorded this edit but didn't provide the patch.",
    tooLarge: "This edit is too large to show in full here.",
    empty: "This edit has no text changes.",
  },
)
