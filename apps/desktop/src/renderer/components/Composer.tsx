import { useId } from "react"
import { Prompt } from "./Prompt.js"
import { takeCommand } from "./ComposerAction.js"
import { Chips } from "./Chips.js"
import { Attachments } from "./Attachments.js"
import { Bar } from "./ComposerBar.js"
import { useAttachments } from "../useAttachments.js"
import type { EngineId, EngineInfo, ModelOption, SlashCommand, Trust, Usage } from "@omni/protocol"
import type { TrustHint } from "../trustHint.js"
import { useComposerDraft } from "../use-composer-draft.js"
import { dropzone, nothingToSend, projectOf, stateOf } from "./composer-state.js"
import { useAsideMode } from "../use-aside-mode.js"
import { AsideChip } from "./aside-chip.js"

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

interface Props {
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
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  /** 第三个参数：**别排队，现在就插进正在跑的那一轮**（⌘⏎）。 */
  onSend: (text: string, attachments: readonly string[], steer: boolean) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
}

function attachmentWarning(
  count: number,
  canAttach: boolean,
  pending: Props["pending"],
): string | undefined {
  if (count === 0) return undefined
  if (pending !== undefined) return "请先完成引擎切换，再确认新引擎能否接收这些附件；附件会保留"
  if (!canAttach) return "当前引擎不支持附件；附件已保留，请移除或切回支持附件的引擎"
  return undefined
}

function AttachmentWarning({ text }: { text: string | undefined }): React.JSX.Element | null {
  return text === undefined ? null : (
    <p className="composer__attachwarn" role="status">{text}</p>
  )
}

/**
 * 贵档那圈边。**描边取的是同一条深空坡道**（靛 → 紫 → 品红），不是一色品红：
 * 一色品红说的是「警告」，而条子上是一片星空——两处对不上，就成了两件事。
 *
 * 停点的颜色写在 CSS 里（`.compring__s0/1/2` 的 `stop-color`），深色模式才好整组换。
 * 绕圈那一段共用同一条渐变，所以它转到哪儿就带哪一段的颜色，
 * 不是一枚固定颜色的光点在跑。
 *
 * `id` 走 `useId`：一屏可能同时挂着不止一个输入框，写死 id 的话
 * **先卸载的那个会把 `<defs>` 一起带走**，剩下那个的描边直接变成没有。
 */
function VoidRing(): React.JSX.Element {
  const id = useId()
  return (
    <svg className="compring" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop className="compring__s0" offset="0%" />
          <stop className="compring__s1" offset="48%" />
          <stop className="compring__s2" offset="100%" />
        </linearGradient>
      </defs>
      <rect className="compring__edge" style={{ stroke: `url(#${id})` }} />
      <rect className="compring__orbit" style={{ stroke: `url(#${id})` }} pathLength={100} />
    </svg>
  )
}

export function Composer(props: Props): React.JSX.Element {
  const detached = props.detached ?? false
  const busy = props.busy ?? false
  const starting = props.starting ?? false
  // 引擎不支持附件就整套不出现——一个贴上去不会被送达的图比不能贴更糟
  const attach = useAttachments(props.canAttach)
  const attachWarning = attachmentWarning(attach.paths.length, props.canAttach, props.pending)
  const attachmentBlocked = attachWarning !== undefined
  // **跑着的时候照样能打、能发**——发出去是排队，这一轮停了就接上
  const mode = stateOf({ detached, starting, busy, canSteer: props.canSteer })
  // 断开和启动期一样发不出去，那时这个模式没有意义
  const canAside = props.canAside === true && !detached && !starting
  const aside = useAsideMode({ can: canAside, prefill: props.prefill, onAsk: props.onAsk })
  const draft = useComposerDraft({
    prefill: props.prefill,
    engine: props.engine,
    attach,
    blocked: mode.blocked || attachmentBlocked,
    steering: mode.steering,
    onSend: aside.wrapSend(props.onSend),
  })

  return (
    <div className="composer">
      <div
        className="composer__inner"
        {...dropzone(props.canAttach === true, attach.drop)}
      >
        {/*
         * 贵档那圈深空描边。**开关不在这里，在 CSS 里**（`:has(.effort--costly)`）：
         * 滑块上的那个 class 已经是「此刻这一档贵不贵」的唯一真相——**拖动中它跟着
         * 手指走**，而框子说的正是同一件事。在这里再算一遍的话，就得把预览态顺着
         * Bar → BarEffort → EffortSlider 传一遍，传的是同一个值的第二份拷贝，
         * 而且那一份必然慢一整个拖动：它只认已经落档的 `props.effort`。
         */}
        <VoidRing />
        {detached ? null : (
          <Chips
            cwd={props.cwd}
            project={projectOf(props.cwd)}
            stamp={props.stamp}
            passing={props.passing}
          />
        )}
        {/* 附件排在芯片**下面**、正文上面。芯片说的是「这句话会发到哪儿去」，
            是这一块的抬头，得钉在最上面；而附件是这句话的一部分，紧挨着正文才对。
            反过来放的话，贴一张图就把抬头顶下去 72 像素 */}
        <Attachments paths={attach.paths} onRemove={attach.remove} />
        <AttachmentWarning text={attachWarning} />
        <Prompt
          value={draft.text}
          detached={detached}
          starting={starting}
          queueing={mode.queueing}
          steering={mode.steering}
          cwd={props.cwd}
          onPaste={attach.paste}
          commands={aside.commands(props.commands)}
          command={draft.command}
          onClearCommand={() => draft.setCommand(undefined)}
          onCommand={(command) => {
            if (aside.take(command, () => { draft.setText("") })) return
            takeCommand(command, draft.setText, draft.setCommand, props.onOmni)
          }}
          searchFiles={props.searchFiles}
          onChange={draft.setText}
          onSubmit={draft.submit}
          onAside={() => {
            aside.ask(draft.text, draft.command !== undefined, () => { draft.setText("") })
          }}
          asideMode={aside.on}
          onAsideExit={aside.exit}
        />
        <Bar
          detached={detached}
          busy={busy}
          starting={starting}
          empty={nothingToSend({
            attachmentBlocked,
            text: draft.text,
            hasCommand: draft.command !== undefined,
            attachments: attach.paths.length,
          })}
          engine={props.engine}
          engines={props.engines}
          trust={props.trust}
          models={props.models}
          model={props.model}
          effort={props.effort}
          usage={props.usage}
          pending={props.pending}
          onEngineChange={props.onEngineChange}
          onTrustChange={props.onTrustChange}
          hint={props.hint}
          blind={props.blind}
          aside={aside.on ? <AsideChip onExit={aside.exit} /> : undefined}
          asideMode={aside.on}
          onModelChange={props.onModelChange}
          onResume={props.onResume}
          onInterrupt={props.onInterrupt}
          onSend={draft.submit}
        />
      </div>
    </div>
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
