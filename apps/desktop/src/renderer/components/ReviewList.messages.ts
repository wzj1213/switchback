import { count, defineMessages } from "@switchback/i18n"

/** 审核面板左边的文件清单。 */
export const REVIEW_LIST = defineMessages(
  {
    tooMany: (n: number) => `改动太多，这里只列了前面这些，还有 ${String(n)} 个没显示`,
    ignored: (n: number) => `另有 ${String(n)} 个 Git 忽略文件无法核实：`,
    join: (paths: readonly string[]) => paths.join("、"),
    etc: (total: number, _shown: number) => ` 等 ${String(total)} 个`,
    placeholder: "筛选路径…",
    filter: "筛选文件",
    noneFiltered: "当前筛选条件下没有可显示的文件",
    noMatch: "已列出的文件里没有匹配项",
  },
  {
    tooMany: (n) => `Too many changes, so only the first ones are listed; ${count(n, "more file")} not shown`,
    ignored: (n) => `${count(n, "Git-ignored file")} can't be verified: `,
    join: (paths) => paths.join(", "),
    etc: (total, shown) => `, and ${String(total - shown)} more`,
    placeholder: "Filter paths…",
    filter: "Filter files",
    noneFiltered: "No files to show with the current filters",
    noMatch: "No matches among the listed files",
  },
)
