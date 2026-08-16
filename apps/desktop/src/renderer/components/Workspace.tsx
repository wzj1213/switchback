import { useRef, useState } from "react"
import type { Command, EngineInfo, Item, ModelOption, SlashCommand, Thread, Turn, Usage } from "@omni/protocol"
import type { Notice } from "@omni/store"
import { Composer, labelOf } from "./Composer.js"
import { CaretIcon, CompareIcon, ForkIcon } from "./icons.js"
import { useOmniActions } from "../useOmniActions.js"
import { nextEngine } from "../engines.js"
import { EnvCard } from "./EnvCard.js"
import { Transcript } from "./Transcript.js"
import { Changed } from "./Changed.js"
import { ContextMeter } from "./ContextMeter.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"


/**
 * 顶栏。
 *
 * ## 只放「说明状态」的东西，不放「能改状态」的东西
 *
 * 上一版这里摆着引擎和信任档两枚胶囊，而输入区里也有同样两枚——
 * 一样的文字出现在两个地方，**其中一个还点不动**。用户会去点那个点不动的，
 * 然后以为界面坏了。能改的那份留在输入区（手就在那儿），
 * 顶栏只留三类：会话身份、用量、以及**这个会话独有**的动作（分叉、对比）。
 *
 * 动作用图标按钮而不是文字胶囊：和旁边那些纯展示的胶囊长得一样的话，
 * 「可点」这件事就没有任何视觉线索了。
 */
function TopBar({
  thread,
  usage,
  engines,
  peer,
  onFork,
  onCompare,
  onReveal,
  onCopy,
  env,
  setEnv,
}: {
  thread: Thread
  usage: Usage | undefined
  engines: readonly EngineInfo[]
  /** 有血缘的另一个会话。有才显示「对比」。 */
  peer: Thread | undefined
  onFork: (to: string) => void
  onCompare: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  /** 环境卡片开着没有。**状态在 `Workspace` 那层**——`/env` 命令也要能开它。 */
  env: boolean
  setEnv: (open: boolean) => void
}): React.JSX.Element {
  const next = nextEngine(engines, thread.engine)
  const handedOff = thread.engineHistory.length > 1
  const envAnchor = useRef<HTMLButtonElement>(null)
  return (
    <header className="topbar">
      {/* 标题点开是环境信息。**把它挂在标题上**而不是另放一颗按钮：
          「我在哪个会话里」和「这个会话跑在什么环境里」是同一个问题的两半 */}
      <button
        ref={envAnchor}
        type="button"
        className="topbar__title"
        title="环境信息"
        aria-expanded={env}
        onClick={() => {
          setEnv(!env)
        }}
      >
        {thread.title}
        <CaretIcon size={11} />
      </button>
      {env ? (
        <EnvCard
          thread={thread}
          engines={engines}
          anchor={envAnchor.current}
          onReveal={onReveal}
          onCopy={onCopy}
          onClose={() => {
            setEnv(false)
          }}
        />
      ) : null}
      {thread.detached === true ? <span className="badge badge--muted">历史记录</span> : null}
      {handedOff ? (
        <span className="badge" title={thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")}>
          接力 {thread.engineHistory.length} 手
        </span>
      ) : null}
      <span className="topbar__spacer" />
      <ContextMeter usage={usage} />
      {peer === undefined ? null : (
        <button
          className="iconbtn"
          type="button"
          title={`和「${peer.title}」并排比一比（⇧⌘D）`}
          aria-label="对比分叉"
          onClick={onCompare}
        >
          <CompareIcon size={14} />
        </button>
      )}
      {next === undefined ? null : (
        <button
          className="iconbtn"
          type="button"
          title={`用 ${next.label} 另起一个会话跑同一件事（原会话保留）`}
          aria-label={`分叉到 ${next.label}`}
          onClick={() => {
            onFork(next.id)
          }}
        >
          <ForkIcon size={14} />
        </button>
      )}
    </header>
  )
}

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
