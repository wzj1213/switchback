import type { Command, EngineInfo, Item,
  Lane, TaskRun, Thread, Turn, TurnId, TurnPace } from "@switchback/protocol"
import { buildHandoff, compareRuns, comparisonItems, type Comparison, type FileDiff, type Side } from "@switchback/handoff"
import { Transcript } from "./Transcript.js"
import { labelOf } from "./Composer.js"
import { useMessages } from "../i18n.js"
import { COMPARE } from "./Compare.messages.js"

/**
 * 分叉对比。两条有血缘、共用工作区的会话，并排看各自做了什么。
 *
 * ## 差异条为什么排在最上面
 *
 * 两栏 transcript 并排放着好看，但**没什么用**：两边各几十条，人眼没法对齐着读。
 * 真正要回答的问题只有三个——
 *
 * 1. 哪些文件只有一边的编辑工具上报过？
 * 2. 同一个文件两边最后一次成功上报的量差多少？
 * 3. 各自还剩什么没做？
 *
 * 所以顶上先给结论，下面才是过程。结论用的是 `@switchback/handoff` 的
 * `buildHandoff` + `compareRuns`——复用既有的运行摘要逻辑，
 * 不另写一份，免得同一批记录在两处得出不同摘要。
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
  const m = useMessages(COMPARE)
  const mark = file.side === "both" ? (file.differs ? "≠" : "=") : file.side === "a" ? "◀" : "▶"
  return (
    <li className={sideClass(file.side)}>
      <span className="cmp__mark" title={file.side === "both" ? m.both : m.one}>
        {mark}
      </span>
      {/* `<bdi>` 隔离双向文本：不隔的话 `direction: rtl` 会把开头那个 `/` 甩到行尾，
          每一行每一次都错（同一个坑 `.pop__head-path` 修过一次） */}
      <code className="cmp__path"><bdi>{file.path}</bdi></code>
      <span className="cmp__num">{tally(file.a)}</span>
      <span className="cmp__num">{tally(file.b)}</span>
    </li>
  )
}

function Open({ label, steps }: { label: string; steps: readonly string[] }): React.JSX.Element | null {
  const m = useMessages(COMPARE)
  if (steps.length === 0) return null
  return (
    <div className="cmp__open">
      <span className="cmp__open-label">{m.remaining(label)}</span>
      <span>{m.steps(steps)}</span>
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
  // 这一节只画文件；命令存在不该把文件空态变成一块什么都没有的空白。
  const m = useMessages(COMPARE)
  const nothing = diff.files.length === 0
  return (
    <section className="cmp__summary">
      <header className="cmp__head">
        <span className="cmp__head-label">{m.head}</span>
        <span className="cmp__spacer" />
        <span className="cmp__num cmp__num--head">{left}</span>
        <span className="cmp__num cmp__num--head">{right}</span>
      </header>
      {nothing ? (
        <p className="cmp__empty">{m.empty}</p>
      ) : (
        <ul className="cmp__list">
          {diff.files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </ul>
      )}
      {diff.onlyOneSide === 0 ? null : (
        <p className="cmp__flag">
          {m.onlyBefore(diff.onlyOneSide)}<strong>{m.onlyStrong}</strong>{m.onlyAfter}
        </p>
      )}
      {sharedCwd ? (
        <p className="cmp__caveat">
          {m.sharedBefore}<strong>{m.sharedStrong}</strong>{m.sharedAfter}
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
  tasks: readonly TaskRun[]
  thinkingTokens: number | undefined
  lanes: readonly Lane[]
  /** 每一轮的出字节奏：两栏各自分界线上印，对比的正是这个。 */
  paces: Readonly<Record<TurnId, TurnPace>>
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
  const m = useMessages(COMPARE)
  const left = labelOf(engines, a.thread.engine)
  const right = labelOf(engines, b.thread.engine)
  const diff = compareRuns(
    buildHandoff(a.thread, comparisonItems(a.thread, b.thread, a.items)),
    buildHandoff(b.thread, comparisonItems(b.thread, a.thread, b.items)),
  )
  return (
    <main className="main">
      <header className="topbar">
        <span className="topbar__title">{m.title(left, right)}</span>
        <span className="topbar__spacer" />
        <button className="tbtn" type="button" onClick={onClose}>
          {m.exit}
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
                title={m.useTip}
                onClick={() => {
                  onPick(side.thread.id)
                }}
              >
                {m.use}
              </button>
            </header>
            <Transcript
              readOnly
              thread={side.thread}
              items={side.items}
              tasks={side.tasks}
              engines={engines}
              thinkingTokens={side.thinkingTokens}
              paces={side.paces}
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
