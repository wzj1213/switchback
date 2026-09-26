import type { GitState } from "../shared/git.js"

/**
 * 审查页「提交」那一条的几句话：现在是什么状态、主按钮提交什么、为什么点不了。
 *
 * **点不了必须说为什么**（这套界面的老规矩，见 `SettingsBits` 的 `Toggle`）：
 * 一颗灰掉又不解释的「提交」会让人以为是 omni 坏了，而真相往往是会话还在跑、或者有冲突没解决。
 */

export function pendingOf(state: GitState): number {
  return state.staged + state.unstaged + state.untracked
}

/** 只摆不为零的那几项。 */
function nonZero(pairs: readonly (readonly [string, number | undefined])[]): readonly string[] {
  return pairs.filter(([, count]) => (count ?? 0) > 0).map(([label, count]) => `${label} ${String(count)}`)
}

/** 分支，以及和上游差几个提交（有上游才有）。 */
function where(state: GitState): string {
  const name = state.detached === true ? "游离 HEAD" : (state.branch ?? "（还没有分支）")
  const sync = nonZero([["领先", state.ahead], ["落后", state.behind]])
  return sync.length === 0 ? name : `${name}（${sync.join("、")}）`
}

/** 顶上那一行：分支 · 各类计数。 */
export function summaryOf(state: GitState): string {
  const head = where(state)
  if (state.failed === true) return `${head} · 这一次没读到 Git 状态`
  if (pendingOf(state) === 0 && state.conflicted === 0) return `${head} · 工作区干净`
  const counts = nonZero([
    ["已暂存", state.staged], ["未暂存", state.unstaged], ["新文件", state.untracked], ["冲突", state.conflicted],
  ])
  return `${head} · ${counts.join(" · ")}`
}

/**
 * 两颗按钮各提交什么。有已暂存的就以「只提交已暂存」为主——那是人特意挑过的；
 * 什么都没暂存时主按钮就是「全部提交」，不让人先去一个个点暂存。
 */
export function actionsOf(state: GitState): { primary: { all: boolean; label: string }; secondary?: { all: boolean; label: string } } {
  const everything = pendingOf(state)
  const all = { all: true, label: `全部提交（${String(everything)}）` }
  if (state.staged === 0) return { primary: all }
  const staged = { all: false, label: `提交已暂存的 ${String(state.staged)} 个` }
  return everything > state.staged ? { primary: staged, secondary: all } : { primary: staged }
}

/** 为什么现在提交不了。能提交就是 undefined。 */
export function blockedOf(state: GitState, running: boolean, message: string): string | undefined {
  if (running) return "这条会话还在跑：等它停下再提交，免得提交到改了一半的文件"
  if (state.failed === true) return "这一次没读到 Git 状态，点「重读」再试"
  if (state.conflicted > 0) return `有 ${String(state.conflicted)} 个合并冲突没解决`
  if (pendingOf(state) === 0) return "没有可提交的改动"
  if (message.trim() === "") return "先写一句提交说明"
  return undefined
}
