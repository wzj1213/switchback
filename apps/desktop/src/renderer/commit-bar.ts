import type { GitState } from "../shared/git.js"
import type { Locale } from "@switchback/i18n"
import { COMMIT_BAR } from "./commit-bar.messages.js"

type Text = (typeof COMMIT_BAR)[Locale]

/**
 * 审查页「提交」那一条的几句话：现在是什么状态、主按钮提交什么、为什么点不了。
 *
 * **点不了必须说为什么**（这套界面的老规矩，见 `SettingsBits` 的 `Toggle`）：
 * 一颗灰掉又不解释的「提交」会让人以为是 Switchback 坏了，而真相往往是会话还在跑、或者有冲突没解决。
 */

export function pendingOf(state: GitState): number {
  return state.staged + state.unstaged + state.untracked
}

/** 只摆不为零的那几项。 */
function nonZero(pairs: readonly (readonly [string, number | undefined])[], m: Text): readonly string[] {
  return pairs.filter(([, count]) => (count ?? 0) > 0).map(([label, count]) => m.pair(label, count ?? 0))
}

/** 分支，以及和上游差几个提交（有上游才有）。 */
function where(state: GitState, m: Text): string {
  const name = state.detached === true ? m.detached : (state.branch ?? m.noBranch)
  const sync = nonZero([[m.ahead, state.ahead], [m.behind, state.behind]], m)
  return sync.length === 0 ? name : m.sync(name, sync)
}

/** 顶上那一行：分支 · 各类计数。 */
export function summaryOf(state: GitState, locale: Locale): string {
  const m = COMMIT_BAR[locale]
  const head = where(state, m)
  if (state.failed === true) return m.failed(head)
  if (pendingOf(state) === 0 && state.conflicted === 0) return m.clean(head)
  const counts = nonZero([
    [m.staged, state.staged], [m.unstaged, state.unstaged], [m.untracked, state.untracked], [m.conflicted, state.conflicted],
  ], m)
  return `${head} · ${counts.join(" · ")}`
}

/**
 * 两颗按钮各提交什么。有已暂存的就以「只提交已暂存」为主——那是人特意挑过的；
 * 什么都没暂存时主按钮就是「全部提交」，不让人先去一个个点暂存。
 */
export function actionsOf(state: GitState, locale: Locale): { primary: { all: boolean; label: string }; secondary?: { all: boolean; label: string } } {
  const m = COMMIT_BAR[locale]
  const everything = pendingOf(state)
  const all = { all: true, label: m.commitAll(everything) }
  if (state.staged === 0) return { primary: all }
  const staged = { all: false, label: m.commitStaged(state.staged) }
  return everything > state.staged ? { primary: staged, secondary: all } : { primary: staged }
}

/** 为什么现在提交不了。能提交就是 undefined。 */
export function blockedOf(state: GitState, running: boolean, message: string, locale: Locale): string | undefined {
  const m = COMMIT_BAR[locale]
  if (running) return m.blockedRunning
  if (state.failed === true) return m.blockedFailed
  if (state.conflicted > 0) return m.blockedConflicts(state.conflicted)
  if (pendingOf(state) === 0) return m.blockedNothing
  if (message.trim() === "") return m.blockedMessage
  return undefined
}
