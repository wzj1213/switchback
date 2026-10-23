import { count, defineMessages } from "@switchback/i18n"

/** 审核面板顶上那行摘要，与右边没有可看的差异时那一句。`range` 是审核范围的名字。 */
export const REVIEW_EMPTY = defineMessages(
  {
    turnMissing: "这条旧会话没有上一轮工作区快照",
    unverified: (n: number) => `${String(n)} 个 Git 忽略文件无法核实`,
    rangeEmpty: (range: string) => `${range}没有改动`,
    noNet: "本次对话没有净改动",
    noBaseline: "没有对话开场基线；当前工作区相对 HEAD 是干净的",
    rangeCount: (range: string, n: number) => `${range} · ${String(n)} 个文件`,
    files: (n: number) => `${String(n)} 个文件`,
    noBaselineCount: (n: number) => `无对话开场基线 · 工作区相对 HEAD 有 ${String(n)} 个文件`,
    moreUnverified: (n: number) => `另有 ${String(n)} 个 Git 忽略文件无法核实`,
    spread: "跨仓库 · 各自相对 HEAD",
    loading: "正在读取 Git 差异…",
    failed: "读取 Git 差异失败，请刷新重试",
    noRepo: "这个工作区不是 git 仓库，没有可比的基线",
    blankTurnMissing: "这条旧会话没有上一轮工作区快照；请改选“未提交”等 Git 范围",
    blankUnverified: (n: number) =>
      `有 ${String(n)} 个 Git 忽略文件，但无法核实它们在本次对话前后的内容；请以文件改动摘要里的引擎上报为准`,
    blankNoBaseline: "这条会话没有可用的开场基线；当前工作区相对 HEAD 是干净的，无法还原本次对话净改动",
    asking: "正在问 git…",
    failedRetry: "读取 Git 差异失败，请刷新后重试",
    noMatchMore: (n: number) => `已列出的文件里没有匹配项；另有 ${String(n)} 个文件未载入`,
    noMatch: "当前筛选条件下没有文件；可调整路径筛选或未跟踪文件开关",
    pick: "左边选一个文件",
  },
  {
    turnMissing: "This older thread has no workspace snapshot from the previous turn",
    unverified: (n) => `${count(n, "Git-ignored file")} can't be verified`,
    rangeEmpty: (range) => `${range}: no changes`,
    noNet: "No net changes in this conversation",
    noBaseline: "No baseline from the start of the conversation; the workspace is clean against HEAD",
    rangeCount: (range, n) => `${range} · ${count(n, "file")}`,
    files: (n) => count(n, "file"),
    noBaselineCount: (n) => `No conversation baseline · ${count(n, "file")} changed against HEAD`,
    moreUnverified: (n) => `${count(n, "more Git-ignored file")} can't be verified`,
    spread: "Across repos · each against its own HEAD",
    loading: "Reading the Git diff…",
    failed: "Couldn't read the Git diff. Refresh to try again.",
    noRepo: "This workspace isn't a git repository, so there's nothing to compare against",
    blankTurnMissing: "This older thread has no workspace snapshot from the previous turn. Pick a Git range such as “Uncommitted” instead.",
    blankUnverified: (n) =>
      `${count(n, "Git-ignored file")} can't be checked against how they looked before this conversation. Go by what the engine reported in the edit summary.`,
    blankNoBaseline:
      "This thread has no usable baseline from its start. The workspace is clean against HEAD, so the conversation's net changes can't be reconstructed.",
    asking: "Asking git…",
    failedRetry: "Couldn't read the Git diff. Refresh and try again.",
    noMatchMore: (n) => `No matches among the listed files; ${count(n, "more file")} not loaded`,
    noMatch: "No files match the current filters. Adjust the path filter or the untracked files switch.",
    pick: "Pick a file on the left",
  },
)
