import { defineMessages } from "@switchback/i18n"

/** 审核面板里上一个 / 下一个文件那一条。 */
export const REVIEW_NAV = defineMessages(
  {
    label: "文件导航",
    prev: "上一个改动文件",
    next: "下一个改动文件",
    position: (at: number, total: number) => `${String(at)} / ${String(total)} 文件`,
    fixedWrap: "并排视图保持换行以对齐两侧",
    wrapTip: "切换长行自动换行",
    wrap: "自动换行",
  },
  {
    label: "File navigation",
    prev: "Previous changed file",
    next: "Next changed file",
    position: (at, total) => `${String(at)} / ${String(total)} files`,
    fixedWrap: "The split view keeps lines wrapped so both sides stay aligned",
    wrapTip: "Toggle wrapping for long lines",
    wrap: "Wrap lines",
  },
)
