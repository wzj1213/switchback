import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { REVIEW_EMPTY } from "./review-empty.messages.js"

type Text = (typeof REVIEW_EMPTY)[Locale]

interface EmptyState {
  noRepo: boolean
  /** 这张清单是跨几个仓库并起来的（工作区自己不是仓库）。 */
  spread?: boolean
  loading?: boolean
  failed?: boolean
  baseline?: boolean
  more?: number
  total: number
  shown?: number
  unverified?: number
  range?: string
  turnMissing?: boolean
}

function unverifiedOf(state: EmptyState): number {
  return state.unverified ?? 0
}

function zeroSummary(state: EmptyState, m: Text): string {
  if (state.turnMissing === true) return m.turnMissing
  const unverified = unverifiedOf(state)
  if (unverified > 0) return m.unverified(unverified)
  if (state.range !== undefined) return m.rangeEmpty(state.range)
  return state.baseline === true ? m.noNet : m.noBaseline
}

function DiffStats({ state, added, removed }: {
  state: EmptyState
  added: number
  removed: number
}): React.JSX.Element {
  if (state.more !== undefined) return <></>
  return (
    <>
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </>
  )
}

function ChangedSummary({ state, added, removed }: {
  state: EmptyState
  added: number
  removed: number
}): React.JSX.Element {
  const m = useMessages(REVIEW_EMPTY)
  const unverified = unverifiedOf(state)
  return (
    <>
      <span className="rv__count">
        {state.range !== undefined
          ? m.rangeCount(state.range, state.total)
          : state.baseline === true
          ? m.files(state.total)
          : m.noBaselineCount(state.total)}
      </span>
      {unverified > 0 ? <span className="rv__count">{m.moreUnverified(unverified)}</span> : null}
      <DiffStats state={state} added={added} removed={removed} />
      {/* 跨仓库那一档：数字各自相对它自己那个仓库的 HEAD，**不是**本次对话的净改动。
          不说的话这几个数看起来和单仓库那档一模一样，而它们的口径不同 */}
      {state.spread === true ? <span className="rv__note">{m.spread}</span> : null}
    </>
  )
}

export function ReviewSummary({ state, added, removed }: {
  state: EmptyState
  added: number
  removed: number
}): React.JSX.Element {
  const m = useMessages(REVIEW_EMPTY)
  if (state.loading === true) return <span className="rv__count">{m.loading}</span>
  if (state.failed === true) return <span className="rv__count">{m.failed}</span>
  if (state.noRepo) return <span className="rv__count">{m.noRepo}</span>
  if (state.total === 0) return <span className="rv__count">{zeroSummary(state, m)}</span>
  return <ChangedSummary state={state} added={added} removed={removed} />
}

function zeroBlank(state: EmptyState, m: Text): string {
  if (state.turnMissing === true) return m.blankTurnMissing
  const unverified = unverifiedOf(state)
  if (unverified > 0) return m.blankUnverified(unverified)
  if (state.range !== undefined) return m.rangeEmpty(state.range)
  return state.baseline === true ? m.noNet : m.blankNoBaseline
}

/** 右侧无补丁时把“干净”“不可比较”“筛选为空”分开说清楚。 */
export function blank(state: EmptyState, locale: Locale): string {
  const m = REVIEW_EMPTY[locale]
  if (state.loading === true) return m.asking
  if (state.failed === true) return m.failedRetry
  if (state.noRepo) return m.noRepo
  if (state.total === 0) return zeroBlank(state, m)
  if (state.shown === 0 && state.more !== undefined) return m.noMatchMore(state.more)
  if (state.shown === 0) return m.noMatch
  return m.pick
}
