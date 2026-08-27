import { useCallback, useEffect, useRef, useState } from "react"
import type {
  Command,
  EngineInfo,
  Item,
  Lane,
  ModelOption,
  RateLimits,
  SlashCommand,
  Thread,
  Turn,
  Usage,
  TaskRun,
} from "@omni/protocol"
import type { Notice, ThreadRow } from "@omni/store"
import type { PetKit } from "../../shared/settings.js"
import { WorkspaceComposer } from "./WorkspaceComposer.js"
import { useOmniActions } from "../useOmniActions.js"
import { limitNotice } from "../limits.js"
import { TopBar } from "./TopBar.js"
import { Notices } from "./Notices.js"
import { FindBar, type FindResult } from "./FindBar.js"
import { stampOf } from "../stamp.js"
import { Between } from "./Between.js"
import { ConversationStage } from "./ConversationStage.js"
import type { ComposerDrafts } from "../composer-drafts.js"
import type { ComposerFileReference } from "../file-references.js"

export interface WorkspaceProps {
  drafts: ComposerDrafts
  composerReference?: ComposerFileReference
  thread: Thread
  /** 分叉出来的另一个会话；有才显示顶栏的「对比」。 */
  peer: Thread | undefined
  onCompare: () => void
  items: readonly Item[]
  turn: Turn | undefined
  usage: Usage | undefined
  /** 此刻在跑的子 agent。引擎报了才有，没有就是空数组。 */
  tasks: readonly TaskRun[]
  /** Claude 原生上报的当前思考块近似 token；没有信号就不显示。 */
  thinkingTokens: number | undefined
  lanes: readonly Lane[]
  /** 工作台正开着哪条旁路。主线上那条收成一行，同一棵树不画两遍。 */
  openLane: string | undefined
  onOpenLane: (laneId: string) => void
  panelVisible: boolean
  railOpen: boolean
  onRail: () => void
  /** 任一右侧工具组可见时，拖放提示要覆盖它，而不是藏在输入卡里。 */
  dropSurfaceVisible: boolean
  onTogglePanel: () => void
  /** 从任务画布拖入文件后收起右侧工具组，让结果立刻回到输入框。 */
  onFilesDropped: () => void
  models: readonly ModelOption[]
  engines: readonly EngineInfo[]
  /**
   * 输入框上沿那几只。`on` 关掉是**整块不渲染**（不是藏起来——藏起来它照样
   * 占着指针事件那一层），其余细项见 `PetKit`。
   *
   * 合成一项而不是并排两个 prop：它们永远一起变，而分开传会让「关着的时候
   * 那几项还传不传」变成一个每个调用点各答一遍的问题。
   */
  pets: PetKit & { on: boolean }
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
  /** 打开审核面板并落在某个文件上。转录区那张改动卡点文件名走它。 */
  onOpenFile: (path: string) => void
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
 * - **从待发队列取回**：宿主把文字与附件原子地放回输入区
 *
 * 带一个递增序号：连着点同一条两次，文本一样但序号变了——
 * 输入框据此知道「这是新的一次要求」，而不是「还是刚才那次」。
 */
function useDraft(
  draft: string | undefined,
  draftAttachments: readonly string[] | undefined,
  draftRevision: string | undefined,
): {
  prefill: { text: string; attachments: readonly string[]; at: number; aside?: boolean }
  /** `aside` = 填回去之后**顺手进侧问模式**（选中转录区一段话之后那颗「问一句」）。 */
  reuse: (text: string, attachments?: readonly string[], aside?: boolean) => void
} {
  const [prefill, setPrefill] = useState<{
    text: string
    attachments: readonly string[]
    at: number
    aside?: boolean
  }>({ text: "", attachments: [], at: 0 })
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
    if (draft === undefined) {
      filled.current = undefined
      return
    }
    // 新宿主会给每次取回独立身份；旧记录没有身份时退回文本，保持向后兼容。
    // 不能只认文本：清空与再次取回同一句若被 React 合并，文字没变但它确实是新草稿。
    const identity = draftRevision ?? `legacy:${draft}`
    if (identity === filled.current) return
    filled.current = identity
    setPrefill((prev) => ({ text: draft, attachments: draftAttachments ?? [], at: prev.at + 1 }))
  }, [draft, draftAttachments, draftRevision])
  // **必须 useCallback**：它一路传到 `Transcript`，而那块是 memo 的。
  // 行内箭头每次渲染换身份，memo 立刻静默失效——和 `onResolve` 同一条理由
  const reuse = useCallback((text: string, attachments: readonly string[] = [], aside = false) => {
    setPrefill((prev) => ({ text, attachments, at: prev.at + 1, aside }))
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
  const { prefill, reuse } = useDraft(
    props.thread.draft,
    props.thread.draftAttachments,
    props.thread.draftRevision,
  )
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
        panelVisible={props.panelVisible}
        onPanel={props.onTogglePanel}
        railOpen={props.railOpen}
        onRail={props.onRail}
      />
      <Notices
        notices={props.notices}
        rows={props.rows}
        onDismiss={props.onDismiss}
        onSelect={props.onSelect}
      />
      {props.finding ? <FindBar onFind={props.onFind} onClose={props.onCloseFind} /> : null}
      <ConversationStage
        thread={thread}
        items={props.items}
        turn={props.turn}
        tasks={props.tasks}
        thinkingTokens={props.thinkingTokens}
        engines={props.engines}
        usage={props.usage}
        pets={props.pets}
        send={send}
        onReveal={props.onReveal}
        onReview={props.onReview}
        onOpenFile={props.onOpenFile}
        onCopy={props.onCopy}
        onReuse={reuse}
      >
        <Between
          thread={thread}
          items={props.items}
          send={send}
          stamp={stamp}
          onReveal={props.onReveal}
          onCopy={props.onCopy}
          onReview={props.onReview}
          lanes={props.lanes}
          onOpenLane={props.onOpenLane}
        />
      </ConversationStage>
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
