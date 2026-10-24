import { defineMessages } from "@switchback/i18n"

/** 工作区 `.switchback/` 里那份 `.gitignore` 的说明行。只在第一次写，之后不改。 */
export const HANDOFF_FILES = defineMessages(
  { ignore: "# Switchback 的本地文件（换引擎交接转写），不进版本库\n*\n" },
  { ignore: "# Switchback's local files (handoff transcripts when switching engines); keep them out of version control\n*\n" },
)
