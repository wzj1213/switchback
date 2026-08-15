import type { Command, EngineInfo, Item, Thread, Turn } from "@omni/protocol"
import { buildHandoff, compareRuns, type Comparison, type FileDiff, type Side } from "@omni/handoff"
import { Transcript } from "./Transcript.js"
import { labelOf } from "./Composer.js"

/**
 * 分叉对比。同一个目标交给两家跑，并排看谁做了什么。
 *
 * ## 差异条为什么排在最上面
 *
 * 两栏 transcript 并排放着好看，但**没什么用**：两边各几十条，人眼没法对齐着读。
 * 真正要回答的问题只有三个——
 *
 * 1. 谁动了对方没动的文件？（最可能是「一家做对了、另一家漏了」）
 * 2. 同一个文件两边改的量差多少？
 * 3. 各自还剩什么没做？
 *
 * 所以顶上先给结论，下面才是过程。结论用的是 `@omni/handoff` 的
 * `buildHandoff` + `compareRuns`——和接力包**同一套摘要逻辑**，
 * 不另写一份，免得交接说改了 3 个文件、对比说 4 个。
 *
 * ## 只读
 *
 * 对比视图里不放输入框。要接着聊就退出对比、选中那一边——
 * 摆两个输入框会立刻带出「我刚才是在跟哪家说话」的歧义，
 * 而这个歧义的代价是把一句话发错给了另一家引擎。
 *
 * ## 这不是对照实验，界面必须说出来
 *
 * 分叉出来的两个会话**跑在同一个工作区**。所以后跑的那家会看见先跑的改动——
 * 第一次真跑就复现了：Codex 先补完 JSDoc，Claude 接着跑，
 * 老老实实回答「两个函数都已经有 JSDoc 了，没有需要补的」。
 *
 * 这不是 bug，是分叉当前的语义（同一个工作区、两条对话）。但**摆成两栏并排
 * 之后它看起来就像一次对照实验**，而一次对照实验会得出「Claude 什么都没干」
 * 这种完全错误的结论。所以 cwd 相同时界面上直接写明。
 */

function tally(entry: { added: number; removed: number } | undefined): string {
  if (entry === undefined) return "—"
  return `+${String(entry.added)}−${String(entry.removed)}`
}

function sideClass(side: Side): string {
  return side === "both" ? "cmp__row" : "cmp__row cmp__row--only"
}

function FileRow({ file }: { file: FileDiff }): React.JSX.Element {
  const mark = file.side === "both" ? (file.differs ? "≠" : "=") : file.side === "a" ? "◀" : "▶"
  return (
    <li className={sideClass(file.side)}>
      <span className="cmp__mark" title={file.side === "both" ? "两边都动过" : "只有一边动过"}>
        {mark}
      </span>
      <code className="cmp__path">{file.path}</code>
      <span className="cmp__num">{tally(file.a)}</span>
      <span className="cmp__num">{tally(file.b)}</span>
    </li>
  )
}

function Open({ label, steps }: { label: string; steps: readonly string[] }): React.JSX.Element | null {
  if (steps.length === 0) return null
  return (
    <div className="cmp__open">
      <span className="cmp__open-label">{label}还剩</span>
      <span>{steps.join("、")}</span>
    </div>
  )
}

function Summary({
  diff,
  left,
  right,
  sharedCwd,
}: {
  diff: Comparison
  left: string
  right: string
  /** 两边是同一个工作区。是的话要明说——见本文件开头。 */
  sharedCwd: boolean
}): React.JSX.Element {
  const nothing = diff.files.length === 0 && diff.commands.length === 0
  return (
    <section className="cmp__summary">
      <header className="cmp__head">
        <span className="cmp__head-label">改了什么</span>
        <span className="cmp__spacer" />
        <span className="cmp__num cmp__num--head">{left}</span>
        <span className="cmp__num cmp__num--head">{right}</span>
      </header>
      {nothing ? (
        <p className="cmp__empty">两边都还没动过工作区里的东西。</p>
      ) : (
        <ul className="cmp__list">
          {diff.files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </ul>
      )}
      {diff.onlyOneSide === 0 ? null : (
        <p className="cmp__flag">
          有 {diff.onlyOneSide} 个文件<strong>只有一边</strong>动过——通常是这里出的分歧。
        </p>
      )}
      {sharedCwd ? (
        <p className="cmp__caveat">
          两边跑在<strong>同一个工作区</strong>，后跑的那家看得见先跑的改动——这不是一次对照实验。
        </p>
      ) : null}
      <Open label={left} steps={diff.open.a} />
      <Open label={right} steps={diff.open.b} />
    </section>
  )
}

export interface ComparePane {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
}

export function Compare({
  a,
  b,
  engines,
  onCopy,
  onPick,
  onClose,
  send,
}: {
  a: ComparePane
  b: ComparePane
  engines: readonly EngineInfo[]
  onCopy: (text: string) => void
  /** 点某一栏 = 退出对比并选中它。 */
  onPick: (threadId: string) => void
  onClose: () => void
  send: (command: Command) => void
}): React.JSX.Element {
  const left = labelOf(engines, a.thread.engine)
  const right = labelOf(engines, b.thread.engine)
  const diff = compareRuns(buildHandoff(a.thread, a.items), buildHandoff(b.thread, b.items))
  return (
    <main className="main">
      <header className="topbar">
        <span className="topbar__title">对比：{left} ⟷ {right}</span>
        <span className="topbar__spacer" />
        <button className="tbtn" type="button" onClick={onClose}>
          退出对比
        </button>
      </header>
      <Summary diff={diff} left={left} right={right} sharedCwd={a.thread.cwd === b.thread.cwd} />
      <div className="cmp__panes">
        {[a, b].map((side, index) => (
          <section className="cmp__pane" key={side.thread.id}>
            <header className="cmp__pane-head">
              <span className="badge">{index === 0 ? left : right}</span>
              <span className="cmp__spacer" />
              <button
                className="tbtn"
                type="button"
                title="退出对比并切到这一边继续"
                onClick={() => {
                  onPick(side.thread.id)
                }}
              >
                接着用这边
              </button>
            </header>
            <Transcript
              thread={side.thread}
              items={side.items}
              turn={side.turn}
              send={send}
              onCopy={onCopy}
            />
          </section>
        ))}
      </div>
    </main>
  )
}
