import { Prompt } from "./Prompt.js"
import { takeCommand } from "./ComposerAction.js"
import { Chips } from "./Chips.js"
import { Attachments } from "./Attachments.js"
import { Bar } from "./ComposerBar.js"
import { useAttachments } from "../useAttachments.js"
import type { EngineId, EngineInfo, ModelOption, SlashCommand, Trust, Usage } from "@omni/protocol"
import type { TrustHint } from "../trustHint.js"
import { useComposerDraft } from "../use-composer-draft.js"
import { ultraOf } from "./ModelPicker.js"

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
  /** 侧问入口。这一层只往下递。 */
  aside?: React.ReactNode
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
  prefill?: { text: string; attachments?: readonly string[]; at: number }
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  /** 第三个参数：**别排队，现在就插进正在跑的那一轮**（⌘⏎）。 */
  onSend: (text: string, attachments: readonly string[], steer: boolean) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
}

/**
 * 输入区现在处在哪一档。**四档互斥**，而且各有各的文案和右下角那颗键：
 * 历史记录 / 引擎还在起 / 跑着但能插话 / 跑着只能排队。
 *
 * 拎出来是复杂度闸门逼的，但边界也对：这是一次判定，不是渲染。
 */
function stateOf(o: { detached: boolean; starting: boolean; busy: boolean; canSteer: boolean }): {
  blocked: boolean
  queueing: boolean
  steering: boolean
} {
  const running = o.busy && !o.detached
  return {
    // 真正发不出去的只有两种：这是历史记录（背后没有引擎），
    // 以及**引擎还没起来**——后者不禁的话，回车会先清空输入框、
    // 再撞上宿主那句「会话不存在」，打好的一句话就这么没了
    blocked: o.detached || o.starting,
    // **默认排队，不管引擎会不会 steer。** 上一版是「能插就插」，
    // 和 codex 自己的行为正好相反（那边打字回车也是排着的）。
    // `steering` 现在的意思变成「这一条会话**能**当场插入」——
    // 它决定的是提示语和「立刻插入」那颗按钮出不出现，不是默认走哪条路
    queueing: running,
    steering: running && o.canSteer,
  }
}

/** 目录名当项目名。整条绝对路径在芯片里放不下，而尾段正是人叫它的那个名字。 */
function projectOf(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd
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
  const draft = useComposerDraft({
    prefill: props.prefill,
    engine: props.engine,
    attach,
    blocked: mode.blocked || attachmentBlocked,
    steering: mode.steering,
    onSend: props.onSend,
  })

  // ultra 落档时整个输入框进深空态（品红描边 + 绕框高光）
  const ultra = ultraOf(props.models, props.model, props.effort)

  return (
    <div className="composer">
      <div
        className={`composer__inner${ultra ? " composer__inner--ultra" : ""}`}
        onDragOver={(e) => {
          if (props.canAttach) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!props.canAttach) return
          e.preventDefault()
          attach.drop(e.dataTransfer.files)
        }}
      >
        {/* ultra 的绕框高光：pathLength 归一到 100，dasharray 的算术不用量周长 */}
        {ultra ? (
          <svg className="compring" aria-hidden="true">
            <rect className="compring__orbit" pathLength={100} />
          </svg>
        ) : null}
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
          commands={props.commands}
          command={draft.command}
          onClearCommand={() => draft.setCommand(undefined)}
          onCommand={(command) => {
            takeCommand(command, draft.setText, draft.setCommand, props.onOmni)
          }}
          searchFiles={props.searchFiles}
          onChange={draft.setText}
          onSubmit={draft.submit}
        />
        <Bar
          detached={detached}
          busy={busy}
          starting={starting}
          empty={
            attachmentBlocked ||
            (draft.text.trim() === "" && draft.command === undefined && attach.paths.length === 0)
          }
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
          aside={props.aside}
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
