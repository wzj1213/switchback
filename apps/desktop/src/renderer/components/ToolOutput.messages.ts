import { count, defineMessages } from "@switchback/i18n"

/** 工具输出太长时的开关。 */
export const TOOL_OUTPUT = defineMessages(
  { less: "收起", all: (n: number) => `展开全部（还有 ${String(n)} 行）` },
  { less: "Show less", all: (n) => `Show all (${count(n, "more line")})` },
)
