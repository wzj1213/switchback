import type { Command, EngineInfo, Item, ModelOption, Thread, Turn, Usage } from "@omni/protocol"
import type { Notice } from "@omni/store"
import { Composer, TRUSTS, labelOf } from "./Composer.js"
import { Transcript } from "./Transcript.js"
import { ContextMeter } from "./ContextMeter.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"

/**
 * 分叉到「下一家」：引擎清单里当前这家之后的那一个，绕回开头。
 *
 * 只有两家时它就是「另一家」，语义毫无歧义；三家以上时按顺序轮。
 * 做成一个按钮而不是一个下拉：分叉不是常用操作，为它摆一个常驻的选择器
 * 只会把顶栏挤满。
 */
function nextEngine(engines: readonly EngineInfo[], current: string): EngineInfo | undefined {
  if (engines.length < 2) return undefined
  const at = engines.findIndex((e) => e.id === current)
  return engines[(at + 1) % engines.length]
}

function TopBar({
  thread,
  usage,
  engines,
  onFork,
}: {
  thread: Thread
  usage: Usage | undefined
  engines: readonly EngineInfo[]
  onFork: (to: string) => void
}): React.JSX.Element {
  const next = nextEngine(engines, thread.engine)
  const handedOff = thread.engineHistory.length > 1
  return (
    <header className="topbar">
      <span className="topbar__title">{thread.title}</span>
      <span className="topbar__spacer" />
      <ContextMeter usage={usage} />
      {handedOff ? (
        <span className="pill" title={thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")}>
          接力 {thread.engineHistory.length} 手
        </span>
      ) : null}
      {thread.detached === true ? <span className="pill pill--muted">历史记录</span> : null}
      <span className="pill pill--engine">{labelOf(engines, thread.engine)}</span>
      {next === undefined ? null : (
        <button
          className="pill pill--action"
          type="button"
          title={`用 ${next.label} 另起一个会话跑同一件事（原会话保留）`}
          onClick={() => {
            onFork(next.id)
          }}
        >
          ⑂ {next.label}
        </button>
      )}
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
  engines: readonly EngineInfo[]
  notices: readonly Notice[]
  onDismiss: (id: string) => void
  finding: boolean
  onFind: (query: string, next: boolean, forward: boolean) => Promise<FindResult>
  onCloseFind: () => void
  /** 写剪贴板 */
  onCopy: (text: string) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
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
      <TopBar
        thread={thread}
        usage={props.usage}
        engines={props.engines}
        onFork={(to) => {
          send({ type: "thread.fork", threadId: thread.id, to })
        }}
      />
      <Notices notices={props.notices} onDismiss={props.onDismiss} />
      {props.finding ? <FindBar onFind={props.onFind} onClose={props.onCloseFind} /> : null}
      <Transcript thread={thread} items={props.items} turn={props.turn} send={send} onCopy={props.onCopy} />
      <Composer
        detached={thread.detached === true}
        engines={props.engines}
        cwd={thread.cwd}
        searchFiles={props.searchFiles}
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
          // **中途接力**：同一个会话换一家引擎接着做，不是另开一个。
          // 历史留在原地，交接包会作为第一条消息发给接手的那一家。
          send({ type: "thread.handoff", threadId: thread.id, to: next })
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
