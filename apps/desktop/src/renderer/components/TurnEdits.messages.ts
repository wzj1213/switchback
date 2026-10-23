import { count, defineMessages } from "@switchback/i18n"

/** 一轮结束时那张「改了哪些文件」的卡。 */
export const TURN_EDITS = defineMessages(
  {
    label: (n: number) => `这一轮编辑了 ${String(n)} 个文件`,
    title: (n: number) => `已编辑 ${String(n)} 个文件`,
    review: "查看本轮改动",
    fewer: (n: number) => `只显示前 ${String(n)} 个文件`,
    more: (n: number) => `再显示 ${String(n)} 个文件`,
  },
  {
    label: (n) => `${count(n, "file")} edited this turn`,
    title: (n) => `Edited ${count(n, "file")}`,
    review: "Review this turn's changes",
    fewer: (n) => `Show only the first ${String(n)}`,
    more: (n) => `Show ${count(n, "more file")}`,
  },
)
