import { useState } from "react"
import type { CommitResult, GitState } from "../../shared/git.js"
import { actionsOf, blockedOf, pendingOf, summaryOf } from "../commit-bar.js"
import { BranchIcon } from "./icons.js"

/**
 * 审查页底下的「提交」：看完改动顺手提交，不用切去终端。
 *
 * 平时只有一行（分支 · 各类计数 ·「提交…」），不占审核的地方；点开才出说明框和按钮。
 * 只做本地、可撤回的事（暂存、提交），不推送、不丢弃——理由见 `main/git-commit.ts`。
 */
export function CommitBar({ state, running, busy, result, onCommit, onUndo, onReload }: {
  state: GitState | undefined
  /** 这条会话正在跑：提交要等它停下。 */
  running: boolean
  busy: boolean
  result: CommitResult | undefined
  onCommit: (message: string, all: boolean) => Promise<boolean>
  /** 撤销刚才那次提交（`reset --soft`）。写 git 的动作都得有这条回头路。 */
  onUndo: (full: string) => void
  onReload: () => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (state === undefined || !state.repo) return null
  const pending = pendingOf(state)
  return (
    <footer className="rv__commit" aria-label="提交">
      <div className="rv__commit-head">
        <BranchIcon size={13} />
        <span className="rv__commit-sum" title={state.root}>{summaryOf(state)}</span>
        {state.failed === true ? <button type="button" className="tbtn" onClick={onReload}>重读</button> : null}
        {pending > 0 ? (
          <button type="button" className="tbtn" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {open ? "收起" : "提交…"}
          </button>
        ) : null}
      </div>
      {open && pending > 0 ? (
        <CommitForm state={state} running={running} busy={busy} onCommit={onCommit} onDone={() => setOpen(false)} />
      ) : null}
      <Outcome result={result} busy={busy} onUndo={onUndo} />
    </footer>
  )
}

/** 说明框与两颗按钮。⌘↩ 走主按钮那一种。 */
function CommitForm({ state, running, busy, onCommit, onDone }: {
  state: GitState
  running: boolean
  busy: boolean
  onCommit: (message: string, all: boolean) => Promise<boolean>
  onDone: () => void
}): React.JSX.Element {
  const [message, setMessage] = useState("")
  const blocked = blockedOf(state, running, message)
  const { primary, secondary } = actionsOf(state)
  const off = blocked !== undefined || busy
  const commit = (all: boolean): void => {
    if (off) return
    void onCommit(message, all).then((ok) => {
      if (!ok) return
      setMessage("")
      onDone()
    })
  }
  return (
    <div className="rv__commit-form">
      <textarea
        className="rv__commit-msg"
        value={message}
        rows={2}
        placeholder="提交说明：第一行是标题（⌘↩ 提交）"
        aria-label="提交说明"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          commit(primary.all)
        }}
      />
      <div className="rv__commit-actions">
        <button type="button" className="tbtn tbtn--on" disabled={off} title={blocked} onClick={() => commit(primary.all)}>
          {busy ? "提交中…" : primary.label}
        </button>
        {secondary === undefined ? null : (
          <button type="button" className="tbtn" disabled={off} title={blocked} onClick={() => commit(secondary.all)}>
            {secondary.label}
          </button>
        )}
        {blocked === undefined ? null : <span className="rv__commit-why">{blocked}</span>}
      </div>
    </div>
  )
}

/**
 * 刚才那一下的结果。暂存成功不必说话（清单上那枚「已暂存」就是回答），失败与提交成功要说。
 * 提交成功那一行带「撤销」：HEAD 还是它、也没推到远程时，改动原样退回暂存区。
 */
function Outcome({ result, busy, onUndo }: {
  result: CommitResult | undefined
  busy: boolean
  onUndo: (full: string) => void
}): React.JSX.Element | null {
  if (result === undefined || (result.ok && result.sha === undefined && result.undone !== true)) return null
  if (result.undone === true) {
    return <p className="rv__commit-note rv__commit-note--ok" role="status">已撤销那次提交，改动回到了暂存区。</p>
  }
  if (result.ok) {
    const full = result.full
    return (
      <p className="rv__commit-note rv__commit-note--ok" role="status">
        已提交 <code>{result.sha}</code>「{result.subject}」
        {full === undefined ? null : (
          <button type="button" className="rv__stage rv__undo" disabled={busy} title="退回这次提交（git reset --soft），改动留在暂存区" onClick={() => { onUndo(full) }}>
            撤销
          </button>
        )}
      </p>
    )
  }
  return (
    <>
      <p className="rv__commit-note rv__commit-note--error" role="alert">{result.error ?? "没成功。"}</p>
      {result.output === undefined || result.output === "" ? null : <pre className="rv__commit-log">{result.output}</pre>}
    </>
  )
}
