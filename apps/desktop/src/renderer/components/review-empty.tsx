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

function zeroSummary(state: EmptyState): string {
  if (state.turnMissing === true) return "这条旧会话没有上一轮工作区快照"
  const unverified = unverifiedOf(state)
  if (unverified > 0) return `${String(unverified)} 个 Git 忽略文件无法核实`
  if (state.range !== undefined) return `${state.range}没有改动`
  return state.baseline === true
    ? "本次对话没有净改动"
    : "没有对话开场基线；当前工作区相对 HEAD 是干净的"
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
  const unverified = unverifiedOf(state)
  return (
    <>
      <span className="rv__count">
        {state.range !== undefined
          ? `${state.range} · ${String(state.total)} 个文件`
          : state.baseline === true
          ? `${String(state.total)} 个文件`
          : `无对话开场基线 · 工作区相对 HEAD 有 ${String(state.total)} 个文件`}
      </span>
      {unverified > 0 ? <span className="rv__count">另有 {unverified} 个 Git 忽略文件无法核实</span> : null}
      <DiffStats state={state} added={added} removed={removed} />
      {/* 跨仓库那一档：数字各自相对它自己那个仓库的 HEAD，**不是**本次对话的净改动。
          不说的话这几个数看起来和单仓库那档一模一样，而它们的口径不同 */}
      {state.spread === true ? <span className="rv__note">跨仓库 · 各自相对 HEAD</span> : null}
    </>
  )
}

export function ReviewSummary({ state, added, removed }: {
  state: EmptyState
  added: number
  removed: number
}): React.JSX.Element {
  if (state.loading === true) return <span className="rv__count">正在读取 Git 差异…</span>
  if (state.failed === true) return <span className="rv__count">读取 Git 差异失败，请刷新重试</span>
  if (state.noRepo) return <span className="rv__count">这个工作区不是 git 仓库，没有可比的基线</span>
  if (state.total === 0) return <span className="rv__count">{zeroSummary(state)}</span>
  return <ChangedSummary state={state} added={added} removed={removed} />
}

function zeroBlank(state: EmptyState): string {
  if (state.turnMissing === true) return "这条旧会话没有上一轮工作区快照；请改选“未提交”等 Git 范围"
  const unverified = unverifiedOf(state)
  if (unverified > 0) {
    return `有 ${String(unverified)} 个 Git 忽略文件，但无法核实它们在本次对话前后的内容；请以文件改动摘要里的引擎上报为准`
  }
  if (state.range !== undefined) return `${state.range}没有改动`
  return state.baseline === true
    ? "本次对话没有净改动"
    : "这条会话没有可用的开场基线；当前工作区相对 HEAD 是干净的，无法还原本次对话净改动"
}

/** 右侧无补丁时把“干净”“不可比较”“筛选为空”分开说清楚。 */
export function blank(state: EmptyState): string {
  if (state.loading === true) return "正在问 git…"
  if (state.failed === true) return "读取 Git 差异失败，请刷新后重试"
  if (state.noRepo) return "这个工作区不是 git 仓库，没有可比的基线"
  if (state.total === 0) return zeroBlank(state)
  if (state.shown === 0 && state.more !== undefined) {
    return `已列出的文件里没有匹配项；另有 ${String(state.more)} 个文件未载入`
  }
  if (state.shown === 0) return "当前筛选条件下没有文件；可调整路径筛选或未跟踪文件开关"
  return "左边选一个文件"
}
