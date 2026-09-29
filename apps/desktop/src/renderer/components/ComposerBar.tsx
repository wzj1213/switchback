import type { EngineId, EngineInfo, ModelOption, Trust, Usage } from "@omni/protocol"
import { Action } from "./ComposerAction.js"
import { ModelPicker } from "./ModelPicker.js"
import { UsageBadge } from "./UsageRing.js"
import { Select } from "./Select.js"
import { EngineIcon, ShieldIcon } from "./icons.js"
import { TRUSTS, labelOf } from "./Composer.js"
import type { TrustHint } from "../trustHint.js"
import { AttachmentPick } from "./attachment-pick.js"

/**
 * 输入框下面那一排：引擎 / 信任档 / 模型 ＋ 右下角那颗键。
 *
 * 从 `Composer` 拆出来是行数闸门逼的。边界还算清楚：上面是「打什么字」，
 * 这一排是「这句话由谁、以什么权限、用哪个模型去跑」——
 * 四件事都不改文本，只改**这句话的去向**。
 */
/**
 * 档位下面那行说明。**默认不出现**——内容由 `trustHint` 算（见那边的注释）。
 *
 * 拆成一个组件不只是为了 `Bar` 的行数：这一行是唯一一处「界面替引擎说话」的地方，
 * 而**它说的每一句都必须是引擎自己报的**——所以它只渲染算好的文本，
 * 一个字都不在这里拼。
 */
function Hint({
  hint,
  disabled,
  onReapply,
}: {
  hint?: TrustHint
  disabled: boolean
  onReapply: () => void
}): React.JSX.Element | null {
  if (hint === undefined) return null
  return (
    <span
      className={`composer__hint composer__hint--${hint.kind}`}
      /* 全文 + 那句「所以呢」。**全文不能丢**：这一行会被挤窄截断，
         悬停原本就是它唯一读全的办法，`tip` 是加在后面的，不是顶掉它的 */
      title={hint.tip === undefined ? hint.text : `${hint.text}\n\n${hint.tip}`}
    >
      {hint.text}
      {hint.action === undefined ? null : (
        <button type="button" className="composer__hintact" disabled={disabled} onClick={onReapply}>
          {hint.action.label}
        </button>
      )}
    </span>
  )
}

/**
 * 信任档选择器。
 *
 * 单拎出来不只是行数：**「这家不报自己的档」那句话挂在它的悬停上**，
 * 而那是一句永不改变的静态说明（claude 的 `modeReadback` 恒为 false）。
 * 上一版把它常驻在输入区那一排里，等于每条 claude 会话上永久挂一行噪音，
 * 还把模型选择器顶到了一边。**该主动说的是「此刻发生了什么」，
 * 「这家引擎是什么样」放在你去看它的时候说。**
 */
function TrustSelect({
  trust,
  blind,
  disabled,
  onPick,
}: {
  trust: Trust
  blind?: string
  disabled: boolean
  onPick: (next: Trust) => void
}): React.JSX.Element {
  return (
    <Select
      label={labelOf(TRUSTS, trust)}
      icon={<ShieldIcon />}
      name="信任档"
      title={blind}
      disabled={disabled}
      sections={[
        {
          value: trust,
          onPick: (id) => {
            onPick(id as Trust)
          },
          choices: TRUSTS.map((item) => ({
            id: item.id,
            label: item.label,
            description: item.hint,
          })),
        },
      ]}
    />
  )
}

/**
 * 引擎选择器。探测出「没装」的**仍然可选**，只在右边加个记号：探测也会错，
 * 硬拦住一个其实能用的引擎比不检查更糟。真起不来时横幅会说原因。
 */
function EngineSelect({
  engine,
  engines,
  disabled,
  onPick,
}: {
  engine: EngineId
  engines: readonly EngineInfo[]
  disabled: boolean
  onPick: (next: EngineId) => void
}): React.JSX.Element {
  return (
    <Select
      label={labelOf(engines, engine)}
      icon={<EngineIcon />}
      name="引擎"
      disabled={disabled}
      sections={[
        {
          value: engine,
          onPick,
          choices: engines.map((item) => ({
            id: item.id,
            label: item.label,
            ...(item.state === "missing" ? { note: "未安装" } : {}),
            ...(item.state === "unavailable" ? { note: "起不来" } : {}),
            ...(item.detail === undefined ? {} : { description: item.detail }),
          })),
        },
      ]}
    />
  )
}

export function Bar({
  detached,
  busy,
  starting,
  empty,
  engine,
  engines,
  trust,
  hint,
  blind,
  aside,
  asideMode,
  site,
  models,
  model,
  effort,
  usage,
  pending,
  onEngineChange,
  onTrustChange,
  onModelChange,
  onAttach,
  onResume,
  onInterrupt,
  onSend,
}: {
  detached: boolean
  busy: boolean
  /** 引擎还在起：右下角那颗键是禁着的「发送」，不是「停止」。 */
  starting: boolean
  empty: boolean
  engine: EngineId
  engines: readonly EngineInfo[]
  trust: Trust
  hint?: TrustHint
  /** 「这家不会把自己改的档告诉 omni」那句。**挂在档位选择器的悬停上，不常驻。** */
  blind?: string
  /** 侧问模式的芯片。由上层给，`Bar` 只负责摆在哪儿。不在这个模式时是 undefined。 */
  aside?: React.ReactNode
  /** 侧问模式：右下角那颗键换色、换说明。 */
  asideMode?: boolean
  /**
   * 工作区芯片（分支、脏标、本轮已放行）。起手和开工都摆在这一排：那一行在会话里
   * 一整屏都不变，而输入卡是唯一压着正文的东西——摆在这儿分支照样看得见，输入卡少一行。
   */
  site?: React.ReactNode
  /** 上下文用量：模型选择器把它画成触发器上的进度环。 */
  usage?: Usage
  models: readonly ModelOption[]
  model?: string
  effort?: string
  /** 有待切换的引擎时它的名字；模型选择器据此说明自己在等什么。 */
  /** 待切换的引擎：名字 + 「现在就兑现」。两者总是一起出现，所以是一项不是两项。 */
  pending?: { label: string; onSwitchNow: () => void }
  onEngineChange: (next: EngineId) => void
  onTrustChange: (next: Trust) => void
  onModelChange: (model: string, effort?: string) => void
  onAttach: () => void
  onResume?: () => void
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  return (
    <div className="composer__barwrap">
      <div className="composer__bar">
        <div className="composer__tools">
          <AttachmentPick disabled={detached} onPick={onAttach} />
          <TrustSelect trust={trust} blind={blind}
            disabled={detached || busy || starting || pending !== undefined} onPick={onTrustChange} />
          {site}
          {aside}
        </div>
        <div className="composer__model">
          <UsageBadge usage={usage} />
          <EngineSelect engine={engine} engines={engines} disabled={detached || starting} onPick={onEngineChange} />
          <ModelPicker
            models={models}
            model={model}
            effort={effort}
            disabled={detached || busy || starting}
            pending={pending}
            onChange={onModelChange}
          />
        </div>
        <Action
          detached={detached}
          busy={busy}
          starting={starting}
          empty={empty}
          aside={asideMode === true}
          onResume={onResume}
          onInterrupt={onInterrupt}
          onSend={onSend}
        />
      </div>
      {/* **自己一行**：挤在两个选择器中间时它把模型选择器顶到一边，而且被截断 */}
      <Hint hint={hint} disabled={detached || busy || starting} onReapply={() => { onTrustChange(trust) }} />
    </div>
  )
}
