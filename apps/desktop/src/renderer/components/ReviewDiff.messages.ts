import { defineMessages } from "@switchback/i18n"

/** 审核面板右边的差异区。 */
export const REVIEW_DIFF = defineMessages(
  {
    skip: {
      binary: "二进制文件，不显示内容",
      large: "这份改动太大，画出来会把界面卡住——用 git 看它",
      gone: "取不到这个文件的改动",
      failed: "读取这份改动失败，请刷新后重试",
    },
    quotedTip: "这一段已经放进输入框了",
    quoteTip: "把这一段改动连同位置放进输入框，写一句你要它怎么改",
    quoted: "已引用",
    quote: "引用",
    reading: "正在读改动…",
    noNet: "当前没有可显示的净改动",
    splitLabel: "并排文件改动，可滚动",
    label: "文件改动，可滚动",
  },
  {
    skip: {
      binary: "Binary file; contents aren't shown",
      large: "This change is too large to draw without freezing the interface. Look at it with git.",
      gone: "Couldn't get this file's changes",
      failed: "Couldn't read this change. Refresh and try again.",
    },
    quotedTip: "This hunk is already in the input",
    quoteTip: "Put this hunk and its location in the input, then say how you want it changed",
    quoted: "Quoted",
    quote: "Quote",
    reading: "Reading changes…",
    noNet: "No net changes to show",
    splitLabel: "Side-by-side file changes, scrollable",
    label: "File changes, scrollable",
  },
)
