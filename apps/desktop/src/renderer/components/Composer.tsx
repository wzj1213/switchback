import type { EngineId, EngineInfo, ModelOption, SlashCommand, Trust, Usage } from "@omni/protocol"
import type { TrustHint } from "../trustHint.js"
import { useComposerDraft } from "../use-composer-draft.js"
import { attachmentWarning, stateOf } from "./composer-state.js"
import type { ComposerDrafts } from "../composer-drafts.js"
import { useComposerMemory, useRememberComposer } from "../use-composer-memory.js"
import { useComposerFiles } from "../use-composer-files.js"
import { useComposerFocus } from "../use-composer-focus.js"
import type { ComposerFileReference } from "../file-references.js"
import { ComposerBody } from "./composer-body.js"

/**
 * 信任档。
 *
 * `hint` 不是可有可无的：这三个词说得出**档位叫什么**，说不出
 * **它到底会不会问我**。而这正是用户在改这个控件时唯一关心的事。
 *
 * ## 为什么现在叫「自动审批 / 完全访问」
 *
 * 用户要的中间档就是 Codex 的 “Approve for me”：越界时先交给引擎自己的评审器，
 * 只有它判成潜在不安全才问人。Claude、Kimi 与 Grok 都对应各自的原生 Auto，
 * 由引擎自己的分类器做后台安全检查。最高档才是 Full Access / YOLO / Bypass 这类最宽权限。
 *
 * 档位 id 不动（历史 journal 仍然读得回来）；各家底层不完全同型，具体行为仍由
 * 它们正式暴露的权限入口决定，omni 不拿自己的静态判断冒充引擎原生自动审批。
 */
const TRUSTS: readonly { id: Trust; label: string; hint: string }[] = [
  { id: "read-only", label: "只读", hint: "只允许读取和只读命令；修改与联网会被拒绝" },
  {
    id: "auto-edit",
    label: "自动审批",
    hint: "优先使用引擎原生安全评审；需要人工决定时才询问",
  },
  { id: "full", label: "完全访问", hint: "最宽权限；允许工作区外操作与联网，通常不再询问" },
]

export interface ComposerProps {
  threadId: string
  drafts: ComposerDrafts
  /** 档位下面那行说明。**内容由 `trustHint` 算，这一层只往下递、不解释。** */
  hint?: TrustHint
  /** 「这家不报自己的档」那句，挂在档位选择器的悬停上。 */
  blind?: string
  /** 这条会话能不能侧问（引擎报了能力、已经开过工）。**报不了就整套不存在**。 */
  canAside?: boolean
  /** 把这一句当侧问发出去。`canAside` 为真时必然给。 */
  onAsk?: (text: string) => void
  /** 回放出来的历史会话：背后没有引擎，只能读不能发。 */
  detached?: boolean
  /** 新建的临时会话挂载后直接准备输入；切换旧会话不抢侧栏焦点。 */
  focusOnMount?: boolean
  /** 引擎还在起、或者上一轮还没跑完。**发不出去，而且要说出来为什么**。 */
  busy?: boolean
  /** 引擎还在起。**和 `busy` 不是一回事**：那时什么都没在跑，而且发不出去。 */
  starting?: boolean
  /** busy 时「发送」变成「停止」，点它中断当前轮次。 */
  onInterrupt?: () => void
  engine: EngineId
  /** 可选引擎。**由宿主给**，不在这里写死——写死的那份迟早和真正注册了的对不上。 */
  engines: readonly EngineInfo[]
  trust: Trust
  /** 可选模型。空数组时不显示选择器——没得选就别摆一个空下拉。 */
  models: readonly ModelOption[]
  /** 当前模型；undefined 表示用引擎自己的默认 */
  model: string | undefined
  effort: string | undefined
  /** 上下文用量：模型选择器把它画成触发器上的进度环。 */
  usage?: Usage
  /**
   * 有待切换的引擎时它的名字。**模型选择器据此变成一句说明**——
   * 手上这份清单是旧那家报的，不能让人挑，但也不该凭空消失。
   */
  /** 待切换的引擎：名字 + 「现在就兑现」。见 `ModelPicker`。 */
  pending?: { label: string; onSwitchNow: () => void }
  onModelChange: (model: string, effort?: string) => void
  /** 工作区绝对路径，`@` 文件引用要用 */
  cwd: string
  /** 轮次状态。变一次芯片就重新问一遍 git——引擎改完文件之后「脏不脏」就变了。 */
  stamp: string
  /** 这一轮点过「本轮剩下的都放行」。芯片要说出来。 */
  passing: boolean
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /** 能用的斜杠命令：引擎报的 ＋ omni 自己的，`Workspace` 拼好再给。 */
  commands: readonly SlashCommand[]
  /** 选中了一条 omni 自己的命令（`source === "omni"`），就地执行。 */
  onOmni: (name: string) => void
  /** 这家引擎收不收附件。不收就不给贴图入口。 */
  canAttach: boolean
  /**
   * 这家引擎能不能**跑到一半改向**。
   *
   * 只影响一句提示词，但那句话说的是两件完全不同的事：能改向的话你现在打的
   * 立刻起作用，不能的话要等这一轮跑完。说错了比不说更糟——用户会照着
   * 「立刻起作用」的预期去打断自己已经跑了两分钟的活。
   */
  canSteer: boolean
  /** 外面塞进来的文本（「改一改再发」）。`at` 变了才生效。 */
  prefill?: { text: string; attachments?: readonly string[]; at: number; aside?: boolean }
  /** 文件工作台点「引用」后追加到现有草稿；和替换正文的 prefill 不是同一种动作。 */
  reference?: ComposerFileReference
  /** 从当前任务画布拖入文件后，收起可能挡在输入框前面的工作台。 */
  onFilesDropped: () => void
  /** 工作台展开时，拖放提示要提升到抽屉之上，不能继续藏在输入卡里。 */
  workbenchVisible: boolean
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  /** 第三个参数：**别排队，现在就插进正在跑的那一轮**（⌘⏎）。 */
  onSend: (text: string, attachments: readonly string[], steer: boolean) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
}

export function Composer(props: ComposerProps): React.JSX.Element {
  const { detached = false, busy = false, starting = false } = props
  const focus = useComposerFocus({
    detached,
    initial: props.focusOnMount === true,
    prefillAt: props.prefill?.at ?? 0,
  })
  const { initial, attach, aside, imageAttachments } = useComposerMemory({
    drafts: props.drafts,
    threadId: props.threadId,
    engine: props.engine,
    canAttach: props.canAttach,
    canAside: props.canAside === true && !detached && !starting,
    prefill: props.prefill,
    onAsk: props.onAsk,
  })
  const attachWarning = attachmentWarning({
    attachments: attach.paths.length,
    canAttach: props.canAttach,
    pending: props.pending !== undefined,
    aside: aside.on,
  })
  const attachmentBlocked = attachWarning !== undefined
  const mode = stateOf({ detached, starting, busy, canSteer: props.canSteer })
  const draft = useComposerDraft({
    prefill: props.prefill,
    engine: props.engine,
    attach,
    blocked: mode.blocked || attachmentBlocked,
    steering: mode.steering,
    initial,
    onSend: aside.wrapSend(props.onSend),
  })
  const files = useComposerFiles({
    attach,
    canAttach: imageAttachments,
    editable: !detached,
    cwd: props.cwd,
    setText: draft.setText,
    focus: focus.focus,
    onFilesDropped: props.onFilesDropped,
    reference: props.reference,
  })
  useRememberComposer({
    drafts: props.drafts,
    threadId: props.threadId,
    engine: props.engine,
    text: draft.text,
    attachments: attach.paths,
    command: draft.command,
    aside: aside.on,
  })
  return (
    <ComposerBody
      composer={props}
      detached={detached}
      busy={busy}
      starting={starting}
      focus={focus}
      attach={attach}
      aside={aside}
      attachWarning={attachWarning}
      attachmentBlocked={attachmentBlocked}
      mode={mode}
      draft={draft}
      files={files}
    />
  )
}

/** 引擎/档位 id → 展示名。顶栏、导出、菜单都要用同一套措辞。 */
export function labelOf<T extends { id: string; label: string }>(
  list: readonly T[],
  id: string,
): string {
  return list.find((x) => x.id === id)?.label ?? id
}

export { TRUSTS }
