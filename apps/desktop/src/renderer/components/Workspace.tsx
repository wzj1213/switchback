import type { Command, Item, ModelOption, Thread, Turn, Usage } from "@omni/protocol"
import type { Notice } from "@omni/store"
import { Composer, ENGINES, TRUSTS, labelOf } from "./Composer.js"
import { Transcript } from "./Transcript.js"
import { ContextMeter } from "./ContextMeter.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"

function TopBar({ thread, usage }: { thread: Thread; usage: Usage | undefined }): React.JSX.Element {
  const handedOff = thread.engineHistory.length > 1
  return (
    <header className="topbar">
      <span className="topbar__title">{thread.title}</span>
      <span className="topbar__spacer" />
      <ContextMeter usage={usage} />
      {handedOff ? (
        <span className="pill" title={thread.engineHistory.join(" → ")}>
          接力自 {labelOf(ENGINES, thread.engineHistory[0] ?? "")}
        </span>
      ) : null}
      {thread.detached === true ? <span className="pill pill--muted">历史记录</span> : null}
      <span className="pill pill--engine">{labelOf(ENGINES, thread.engine)}</span>
      <span className="pill">{labelOf(TRUSTS, thread.trust)}</span>
    </header>
  )
}

export interface WorkspaceProps {
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  usage: Usage | undefined
  models: readonly ModelOption[]
  notices: readonly Notice[]
  onDismiss: (id: string) => void
  finding: boolean
  onFind: (query: string, next: boolean, forward: boolean) => Promise<FindResult>
  onCloseFind: () => void
  /** 写剪贴板 */
  onCopy: (text: string) => void
  send: (command: Command) => void
}

/**
 * 一个会话的主区：顶栏 / 故障横幅 / 查找条 / 正文 / 输入区。
 *
 * 从 `App` 拆出来纯粹是因为 `App` 撑过了行数闸门——但拆完读起来确实更顺：
 * `App` 只管「选哪个会话、怎么新建」，这里只管「一个会话长什么样」。
 */
export function Workspace(props: WorkspaceProps): React.JSX.Element {
  const { thread, send } = props
  return (
    <main className="main">
      <TopBar thread={thread} usage={props.usage} />
      <Notices notices={props.notices} onDismiss={props.onDismiss} />
      {props.finding ? <FindBar onFind={props.onFind} onClose={props.onCloseFind} /> : null}
      <Transcript thread={thread} items={props.items} turn={props.turn} send={send} onCopy={props.onCopy} />
      <Composer
        detached={thread.detached === true}
        models={props.models}
        model={thread.model}
        effort={thread.effort}
        onModelChange={(model, effort) => {
          send({ type: "thread.setModel", threadId: thread.id, model, ...(effort === undefined ? {} : { effort }) })
        }}
        // 两个选择器都读**当前会话**的真实值。各存一份局部状态的话，
        // 顶栏写着 Codex、选择器写着 Claude Code——一个会撒谎的控件比没有更糟。
        engine={thread.engine}
        trust={thread.trust}
        onEngineChange={(next) => {
          // 换引擎 = 在同一个工作区另开一个会话。会话中途接力（`thread.handoff`）
          // 还没实现，与其让这个下拉框点了没反应，不如让它做一件真做得到的事。
          send({
            type: "thread.create",
            cwd: thread.cwd,
            engine: next,
            trust: thread.trust,
            title: thread.title,
          })
        }}
        onTrustChange={(next) => {
          send({ type: "thread.setTrust", threadId: thread.id, trust: next })
        }}
        onSend={(text) => {
          send({ type: "thread.prompt", threadId: thread.id, text })
        }}
        onResume={() => {
          send({ type: "thread.resume", threadId: thread.id })
        }}
      />
    </main>
  )
}
