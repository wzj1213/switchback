import { useCallback, useEffect, useRef, useState } from "react"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { Command, EngineInfo, Item, ModelOption, RateLimits, SlashCommand, Thread, Turn, Usage } from "@omni/protocol"
import type { Notice, ThreadRow } from "@omni/store"
import { Composer, labelOf } from "./Composer.js"
import { useOmniActions } from "../useOmniActions.js"
import { limitNotice } from "../limits.js"
import { TopBar } from "./TopBar.js"
import { Transcript } from "./Transcript.js"
import { Changed } from "./Changed.js"
import { Queued } from "./Queued.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"
import { stampOf } from "../stamp.js"



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
  /** 全部会话。故障横幅要靠它说清「出事的是哪一条」。 */
  rows: readonly ThreadRow[]
  onDismiss: (id: string) => void
  /** 点横幅上那个名字跳过去。 */
  onSelect: (id: string) => void
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
  /** 打开审核面板。变更汇总卡上那颗按钮走这条。 */
  onReview: () => void
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
/**
 * 输入框里的待发文本。两个来源：
 *
 * - **「改一改再发」**：点 transcript 里某条消息，把它塞回输入框
 * - **换引擎时的那句话**：告诉新的一家「上一段的记录在这儿」
 *
 * 带一个递增序号：连着点同一条两次，文本一样但序号变了——
 * 输入框据此知道「这是新的一次要求」，而不是「还是刚才那次」。
 */
function useDraft(draft: string | undefined): {
  prefill: { text: string; at: number }
  reuse: (text: string) => void
} {
  const [prefill, setPrefill] = useState<{ text: string; at: number }>({ text: "", at: 0 })
  /**
   * **必须是 effect，不能只在初始化时读一次**：换引擎不会换 thread id，
   * 于是 `Workspace` 根本不重挂载——草稿是在挂载之后才到的，
   * 只在初始化读的话它永远进不来（真机跑出来的：切过去输入框是空的）。
   *
   * 用 ref 记住上次填过哪一份：不记的话每次渲染都覆盖一遍，
   * 你在输入框里打的字会被反复冲掉。
   */
  const filled = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (draft === undefined || draft === filled.current) return
    filled.current = draft
    setPrefill((prev) => ({ text: draft, at: prev.at + 1 }))
  }, [draft])
  // **必须 useCallback**：它一路传到 `Transcript`，而那块是 memo 的。
  // 行内箭头每次渲染换身份，memo 立刻静默失效——和 `onResolve` 同一条理由
  const reuse = useCallback((text: string) => {
    setPrefill((prev) => ({ text, at: prev.at + 1 }))
  }, [])
  return { prefill, reuse }
}

/**
 * 转录区和输入框之间那两块：变更汇总卡、排队中的话。
 *
 * 单独拎出来只为行数闸门，但边界不难受：它们的共同点是**都在描述「还没落定的东西」**
 *（工作区里已经改了什么、你已经打了但还没轮到发的话）。
 */
function Between({ props, thread, stamp, send }: {
  props: WorkspaceProps
  thread: Thread
  stamp: string
  send: (command: Command) => void
}): React.JSX.Element {
  return (
    <>
      <Changed
        items={props.items}
        cwd={thread.cwd}
        stamp={stamp}
        onReveal={props.onReveal}
        onCopy={props.onCopy}
        onReview={props.onReview}
      />
      <Queued
        texts={thread.queued ?? []}
        {...(thread.capabilities?.steer === true
          ? {
              onInsert: () => {
                send({ type: "thread.steerQueued", threadId: thread.id })
              },
            }
          : {})}
        onDrop={() => {
          // 撤回 = 打断队列。宿主那边中断会把队列一并清掉，
          // 但这里不该顺带把**正在跑的那一轮**也停了——所以走一条专门的命令
          send({ type: "thread.unqueue", threadId: thread.id })
        }}
      />
    </>
  )
}

/**
 * 待切换的引擎那一项。
 *
 * 「下一句生效」是对的默认（见 `Thread.nextEngine`），但它有个说不过去的副作用：
 * **换过去之前挑不了新那家的模型**——清单是引擎起来之后自己报的。所以这里除了
 * 名字，还带上「现在就兑现」那条路，由模型选择器画成一颗能点的按钮。
 */
function pendingEngine(
  thread: Thread,
  engines: readonly EngineInfo[],
  send: (command: Command) => void,
): { pending?: { label: string; onSwitchNow: () => void } } {
  const to = thread.nextEngine
  if (to === undefined) return {}
  return {
    pending: {
      label: labelOf(engines, to),
      onSwitchNow: () => {
        send({ type: "thread.switchNow", threadId: thread.id })
      },
    },
  }
}

export function Workspace(props: WorkspaceProps): React.JSX.Element {
  const { thread, send } = props
  const [env, setEnv] = useState(false)
  const [timeline, setTimeline] = useState(false)
  /**
   * 「改一改再发」塞回输入框的文本。
   *
   * 带一个递增序号：连着点同一条两次，文本一样但序号变了——
   * 输入框据此知道「这是新的一次要求」，而不是「还是刚才那次」。
   */
  const { prefill, reuse } = useDraft(props.thread.draft)
  // 一轮开始与结束各问一次 git：引擎改完文件之后「脏不脏」就变了
  const stamp = stampOf(props.turn)
  const actions = useOmniActions(props, {
    onEnv: () => {
      setEnv(true)
    },
    onTimeline: () => {
      setTimeline(true)
    },
  })
  return (
    <main className="main">
      <TopBar
        env={env}
        setEnv={setEnv}
        timeline={timeline}
        setTimeline={setTimeline}
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
      <Notices notices={props.notices} rows={props.rows} onDismiss={props.onDismiss} onSelect={props.onSelect} />
      {props.finding ? <FindBar onFind={props.onFind} onClose={props.onCloseFind} /> : null}
      <Transcript
        thread={thread}
        items={props.items}
        turn={props.turn}
        send={send}
        onCopy={props.onCopy}
        onReuse={reuse}
      />
      <Between props={props} thread={thread} stamp={stamp} send={send} />
      <Composer
        detached={thread.detached === true}
        /* **和当前轮次比一比才算数**：`passTurn` 存的是轮次 id，
           所以「过期」不需要谁记得来清一次——下一轮的 id 不一样，这里自然就是 false */
        passing={thread.passTurn !== undefined && thread.passTurn === props.turn?.id}
        /*
         * **启动期和「上一轮还在跑」是两回事**，上一版把它们并成一个 `busy`，
         * 于是引擎还没起来时屏幕上写着「它还在跑——现在打的会排在后面」，
         * 而其实什么都没在跑；更糟的是输入框没被禁，回车会先清空文本、
         * 再撞上宿主那句「会话不存在」——**那条消息就这么没了**。
         */
        starting={thread.status === "starting"}
        busy={props.turn !== undefined}
        onInterrupt={() => {
          send({ type: "thread.interrupt", threadId: thread.id })
        }}
        engines={props.engines}
        cwd={thread.cwd}
        stamp={stamp}
        searchFiles={props.searchFiles}
        prefill={prefill}
        canAttach={(thread.capabilities ?? NO_CAPABILITIES).attachments}
        canSteer={(thread.capabilities ?? NO_CAPABILITIES).steer}
        commands={[...actions.map((a) => a.command), ...props.commands]}
        onOmni={(name: string) => {
          actions.find((a) => a.command.name === name)?.run()
        }}
        /*
         * 有待切换的引擎时，模型选择器变成**一句点不动的说明**（「切到 Codex 后可选」）。
         * 手上这份清单是**旧那家**报的，它的模型 id 在新的一家那里通常根本不存在，
         * 所以确实不能挑；但上一版是把整个控件藏起来，而一个凭空消失的控件
         * 读起来就是坏了——用户的原话是「切换别的引擎一个模型都不显示」。
         *
         * 只有**开过工的会话**会走到这里：还没说过话的临时会话切引擎是当场切的
         *（见 `Thread.provisional`），那时新那家的清单直接就来了。
         */
        models={props.models}
        model={thread.model}
        effort={thread.effort}
        {...pendingEngine(thread, props.engines, send)}
        onModelChange={(model, effort) => {
          send({ type: "thread.setModel", threadId: thread.id, model, ...(effort === undefined ? {} : { effort }) })
        }}
        // 两个选择器都读**当前会话**的真实值。各存一份局部状态的话，
        // 顶栏写着 Codex、选择器写着 Claude Code——一个会撒谎的控件比没有更糟。
        //
        // `nextEngine` 优先：切引擎现在是「下一句用它」，真正的切换发生在
        // 发出第一句话的时候（见 `Thread.nextEngine`）。选择器要显示**你选的那家**
        // ——显示旧的那家等于告诉他「没选上」。
        engine={thread.nextEngine ?? thread.engine}
        trust={thread.trust}
        onEngineChange={(next) => {
          // **中途接力**：同一个会话换一家引擎接着做，不是另开一个。
          // 历史留在原地；**切回去会续上那一家自己的那条 session**（见 `Thread.segments`），
          // 而不是每次都新开——codex 跑了一半、去 Claude 看一眼再回来，
          // 它该还记得自己做过什么。
          send({ type: "thread.handoff", threadId: thread.id, to: next })
        }}
        onTrustChange={(next) => {
          send({ type: "thread.setTrust", threadId: thread.id, trust: next })
        }}
        onSend={(text, attachments, steer) => {
          send({
            type: "thread.prompt",
            threadId: thread.id,
            text,
            ...(attachments.length === 0 ? {} : { attachments }),
            // 只在真要插的时候带这一项：不带 = 排队（见 protocol 的 `steer`）
            ...(steer ? { steer: true } : {}),
          })
        }}
        onResume={() => {
          send({ type: "thread.resume", threadId: thread.id })
        }}
      />
    </main>
  )
}
