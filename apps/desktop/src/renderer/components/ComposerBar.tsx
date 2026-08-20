import type { EngineId, EngineInfo, ModelOption, Trust } from "@omni/protocol"
import { Action } from "./ComposerAction.js"
import { ModelPicker } from "./ModelPicker.js"
import { Select } from "./Select.js"
import { EngineIcon, ShieldIcon } from "./icons.js"
import { TRUSTS, labelOf } from "./Composer.js"
import type { TrustHint } from "../trustHint.js"

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
  onReapply,
}: {
  hint?: TrustHint
  onReapply: () => void
}): React.JSX.Element | null {
  if (hint === undefined) return null
  return (
    <span className={`composer__hint composer__hint--${hint.kind}`} title={hint.text}>
      {hint.text}
      {hint.action === undefined ? null : (
        <button type="button" className="composer__hintact" onClick={onReapply}>
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
      title={blind ?? "信任档"}
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
 * 跑着的时候那一行：**这句回车下去会怎么样**。
 *
 * ## 为什么不能只写在 placeholder 里
 *
 * 上一版就是那么写的（「它还在跑——回车先排队，⌘⏎ 直接插进去」），
 * 而 placeholder **一打字就消失**——恰恰是你正要按回车、最需要知道后果的那一刻。
 * 于是「能不能中途插话」这件事实际上没人看得见：用户以为 omni 只会排队。
 *
 * ## 两种情况都要说，而且要说得不一样
 *
 * 能插话的（codex / zcode）：告诉你多按一个键就不排队。
 * 不能插话的（grok 实测方法是 `Method not found`，claude 的 SDK 没有这个入口）：
 * **说清楚是这家引擎没有这个能力**，而不是含糊地不提——否则「为什么这儿能那儿不能」
 * 会被当成 omni 时好时坏。
 */
function QueueNote({
  busy,
  canSteer,
}: {
  busy: boolean
  canSteer: boolean
}): React.JSX.Element | null {
  if (!busy) return null
  return (
    <div className="composer__queuenote">
      {canSteer ? (
        <>
          回车排队，<b>⌘↵ 直接插进正在跑的这一轮</b>
        </>
      ) : (
        <>回车排队，这一轮停了就发——这家引擎不支持中途插话</>
      )}
    </div>
  )
}

export function Bar({
  detached,
  busy,
  canSteer,
  starting,
  empty,
  engine,
  engines,
  trust,
  hint,
  blind,
  aside,
  models,
  model,
  effort,
  pending,
  onEngineChange,
  onTrustChange,
  onModelChange,
  onResume,
  onInterrupt,
  onSend,
}: {
  detached: boolean
  busy: boolean
  /** 这条会话**能不能**当场插话（`capabilities.steer`）。决定跑着时那行提示怎么写。 */
  canSteer: boolean
  /** 引擎还在起：右下角那颗键是禁着的「发送」，不是「停止」。 */
  starting: boolean
  empty: boolean
  engine: EngineId
  engines: readonly EngineInfo[]
  trust: Trust
  hint?: TrustHint
  /** 「这家不会把自己改的档告诉 omni」那句。**挂在档位选择器的悬停上，不常驻。** */
  blind?: string
  /** 侧问入口。由上层给，`Bar` 只负责摆在哪儿。 */
  aside?: React.ReactNode
  models: readonly ModelOption[]
  model?: string
  effort?: string
  /** 有待切换的引擎时它的名字；模型选择器据此说明自己在等什么。 */
  /** 待切换的引擎：名字 + 「现在就兑现」。两者总是一起出现，所以是一项不是两项。 */
  pending?: { label: string; onSwitchNow: () => void }
  onEngineChange: (next: EngineId) => void
  onTrustChange: (next: Trust) => void
  onModelChange: (model: string, effort?: string) => void
  onResume?: () => void
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  return (
    <div className="composer__barwrap">
      <div className="composer__bar">
        <Select
          label={labelOf(engines, engine)}
          icon={<EngineIcon />}
          title="引擎"
          disabled={detached}
          sections={[
            {
              value: engine,
              onPick: onEngineChange,
              // 探测出「没装」的**仍然可选**，只在右边加个记号：探测也会错，
              // 硬拦住一个其实能用的引擎比不检查更糟。真起不来时横幅会说原因
              choices: engines.map((item) => ({
                id: item.id,
                label: item.label,
                ...(item.state === "missing" ? { note: "未安装" } : {}),
                ...(item.detail === undefined ? {} : { description: item.detail }),
              })),
            },
          ]}
        />
        <TrustSelect trust={trust} blind={blind} disabled={detached || busy || starting} onPick={onTrustChange} />
        <ModelPicker
          models={models}
          model={model}
          effort={effort}
          disabled={detached}
          pending={pending}
          onChange={onModelChange}
        />
        {aside}
        <span style={{ flex: 1 }} />
        <Action
          detached={detached}
          busy={busy}
          starting={starting}
          empty={empty}
          onResume={onResume}
          onInterrupt={onInterrupt}
          onSend={onSend}
        />
      </div>
      {/* `busy && !detached`：历史会话背后没有引擎，那儿不存在「排队」这回事 */}
      <QueueNote busy={busy && !detached} canSteer={canSteer} />
      {/* **自己一行**：挤在两个选择器中间时它把模型选择器顶到一边，而且被截断 */}
      <Hint
        hint={hint}
        onReapply={() => {
          onTrustChange(trust)
        }}
      />
    </div>
  )
}
