import { useState } from "react"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { Command, EngineInfo, Item, ModelOption, RateLimits, SlashCommand, Thread, Turn, Usage } from "@omni/protocol"
import type { Notice } from "@omni/store"
import { Composer } from "./Composer.js"
import { useOmniActions } from "../useOmniActions.js"
import { limitNotice } from "../limits.js"
import { TopBar } from "./TopBar.js"
import { Transcript } from "./Transcript.js"
import { Changed } from "./Changed.js"
import { Queued } from "./Queued.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"



export interface WorkspaceProps {
  thread: Thread
  /** 分叉出来的另一个会话；有才显示顶栏的「对比」。 */
  peer: Thread | undefined
  onCompare: () => void
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
  /** 在访达里定位工作区。环境卡片上那颗按钮用。 */
  onReveal: (path: string) => void
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /** 引擎报的斜杠命令。omni 自己那几条在这里拼上去。 */
  commands: readonly SlashCommand[]
  /** 这家引擎的账号额度。 */
  limits: RateLimits | undefined
  onSettings: () => void
  /** 让侧栏把当前会话切进改名态。 */
  onRename: () => void
  onNew: () => void
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
  const [env, setEnv] = useState(false)
  const actions = useOmniActions(props, {
    onEnv: () => {
      setEnv(true)
    },
  })
  return (
    <main className="main">
      <TopBar
        env={env}
        setEnv={setEnv}
        limits={limitNotice(props.limits)}
        thread={thread}
        usage={props.usage}
        engines={props.engines}
        peer={props.peer}
        onCompare={props.onCompare}
        onFork={(to) => {
          send({ type: "thread.fork", threadId: thread.id, to })
        }}
        onReveal={props.onReveal}
        onCopy={props.onCopy}
      />
      <Notices notices={props.notices} onDismiss={props.onDismiss} />
      {props.finding ? <FindBar onFind={props.onFind} onClose={props.onCloseFind} /> : null}
      <Transcript thread={thread} items={props.items} turn={props.turn} send={send} onCopy={props.onCopy} />
      <Changed items={props.items} />
      <Queued
        texts={thread.queued ?? []}
        onDrop={() => {
          // 撤回 = 打断队列。宿主那边中断会把队列一并清掉，
          // 但这里不该顺带把**正在跑的那一轮**也停了——所以走一条专门的命令
          send({ type: "thread.unqueue", threadId: thread.id })
        }}
      />
      <Composer
        detached={thread.detached === true}
        // 引擎还在起、或者上一轮还没跑完——两种都发不出去，但原因不同，文案也不同
        busy={thread.status === "starting" || props.turn !== undefined}
        onInterrupt={() => {
          send({ type: "thread.interrupt", threadId: thread.id })
        }}
        engines={props.engines}
        cwd={thread.cwd}
        // 一轮开始与结束各问一次 git：引擎改完文件之后「脏不脏」就变了
        stamp={props.turn === undefined ? "idle" : `${props.turn.id}:${props.turn.status}`}
        searchFiles={props.searchFiles}
        canAttach={(thread.capabilities ?? NO_CAPABILITIES).attachments}
        commands={[...actions.map((a) => a.command), ...props.commands]}
        onOmni={(name: string) => {
          actions.find((a) => a.command.name === name)?.run()
        }}
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
        onSend={(text, attachments) => {
          send({
            type: "thread.prompt",
            threadId: thread.id,
            text,
            ...(attachments.length === 0 ? {} : { attachments }),
          })
        }}
        onResume={() => {
          send({ type: "thread.resume", threadId: thread.id })
        }}
      />
    </main>
  )
}
