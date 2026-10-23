import { defineMessages } from "@switchback/i18n"

/** 靶上那行读数。 */
export const PET_RANGE = defineMessages(
  { first: (seconds: string) => `首字 ${seconds}s` },
  { first: (seconds) => `first token ${seconds}s` },
)
