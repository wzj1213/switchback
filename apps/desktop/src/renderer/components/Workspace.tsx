import { useCallback, useEffect, useRef, useState } from "react"
import type {
  Command,
  EngineInfo,
  Item,
  ModelOption,
  RateLimits,
  SlashCommand,
  Thread,
  Turn,
  Usage,
  TaskRun,
} from "@omni/protocol"
import type { Notice, ThreadRow } from "@omni/store"
import { WorkspaceComposer } from "./WorkspaceComposer.js"
import { useOmniActions } from "../useOmniActions.js"
import { limitNotice } from "../limits.js"
import { TopBar } from "./TopBar.js"
import { Transcript } from "./Transcript.js"
import { Pets } from "./Pets.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"
import { stampOf } from "../stamp.js"
import { Between } from "./Between.js"

export interface WorkspaceProps {
  thread: Thread
  /** 分叉出来的另一个会话；有才显示顶栏的「对比」。 */
  peer: Thread | undefined
  onCompare: () => void
  items: readonly Item[]
  turn: Turn | undefined
  usage: Usage | undefined
  /** 此刻在跑的子 agent。引擎报了才有，没有就是空数组。 */
  tasks: readonly TaskRun[]
  models: readonly ModelOption[]
  engines: readonly EngineInfo[]
  /** 输入框上沿那几只要不要出现。关掉是整块不渲染，见 `shared/settings.ts`。 */
  pets: boolean
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
 * 待切换的引擎那一项。
 *
 * 「下一句生效」是对的默认（见 `Thread.nextEngine`），但它有个说不过去的副作用：
 * **换过去之前挑不了新那家的模型**——清单是引擎起来之后自己报的。所以这里除了
 * 名字，还带上「现在就兑现」那条路，由模型选择器画成一颗能点的按钮。
 */
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
  // 一轮开始与结束各问一次 git：引擎改完文件之后「脏不脏」就变了。
  // 带上 items 是为了**每条 shell 命令收工时也问一次**——只有它能把分支换掉，
  // 而那件事在此之前界面上完全沉默（见 `stamp.ts`）
  const stamp = stampOf(props.turn, props.items)
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
      <Notices
        notices={props.notices}
        rows={props.rows}
        onDismiss={props.onDismiss}
        onSelect={props.onSelect}
      />
      {props.finding ? <FindBar onFind={props.onFind} onClose={props.onCloseFind} /> : null}
      {/* 对话区。**多这一层是为了给吉祥物一块有边界的地**——
          它们要能被拖到任何地方，也要知道「地面」在哪（就是这一块的底边，
          也就是输入框的上沿）。顺带它也是那道下摆渐隐的定位参照 */}
      <div className="stage">
        <Transcript
          thread={thread}
          items={props.items}
          turn={props.turn}
          tasks={props.tasks}
          send={send}
          onCopy={props.onCopy}
          onReuse={reuse}
        />
        {/* 滚动区的下摆。**必须在 `Transcript` 外面**——滚动容器里的绝对定位参照的是
            可滚动内容而不是可视区，挂进去那道渐隐会跟着内容滚走。见 app.css 的 `.hem` */}
        <div className="hem" aria-hidden="true" />
        {props.pets ? (
          <Pets
            engines={props.engines}
            engine={thread.engine}
            running={props.turn?.status === "running"}
          />
        ) : null}
      </div>
      <Between
        thread={thread}
        items={props.items}
        stamp={stamp}
        onReveal={props.onReveal}
        onCopy={props.onCopy}
        onReview={props.onReview}
        send={send}
        onReuse={reuse}
      />
      <WorkspaceComposer
        props={props}
        thread={thread}
        stamp={stamp}
        prefill={prefill}
        actions={actions}
      />
    </main>
  )
}
