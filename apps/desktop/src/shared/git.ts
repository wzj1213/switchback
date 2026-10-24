/** 审查页「提交」那一条在主进程与界面之间传的形状。 */

export interface GitState {
  /** 工作区在不在一个 Git 仓库里。不在就不画这一条。 */
  repo: boolean
  root?: string
  /** 当前分支。游离 HEAD 时缺席，`detached` 为真。 */
  branch?: string
  detached?: boolean
  upstream?: string
  ahead?: number
  behind?: number
  /** 暂存区里有改动的文件数。 */
  staged: number
  /** 工作区里还没暂存的改动（不含新文件）。 */
  unstaged: number
  /** 未跟踪的新文件。 */
  untracked: number
  /** 合并冲突没解决的。有它就不该提交。 */
  conflicted: number
  /** `git status` 这一次没读成：计数不可信。 */
  failed?: true
}

/**
 * 提交栏上「为什么没成」是哪一种。主进程只报种类，说法在渲染层（`CommitBar.messages.ts`）——
 * 那边知道界面用哪种语言。git 和钩子自己打的原文另放在 `output`，不翻译。
 */
export type GitRefusal =
  | "empty-message"
  | "not-repo"
  | "add-failed"
  | "nothing"
  | "nothing-staged"
  | "commit-failed"
  | "head-moved"
  | "pushed"
  | "undo-failed"
  | "outside"
  | "unstage-failed"
  | "not-ours"
  | "bad-message"
  | "bad-path"
  | "bad-commit"

export interface CommitResult {
  ok: boolean
  /** 提交成功时的短哈希与标题行。 */
  sha?: string
  subject?: string
  /** 完整哈希。撤销时拿它核对 HEAD 还是不是这一次提交。 */
  full?: string
  /** 这一次是撤销提交（改动回到了暂存区）。 */
  undone?: true
  error?: GitRefusal
  /** `pushed` 时：已经含有这次提交的那个远程分支。 */
  remote?: string
  /** git 或钩子自己打的原文。失败时这常常是唯一的线索。 */
  output?: string
}
