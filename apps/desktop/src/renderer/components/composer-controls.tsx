import type { EngineId, EngineInfo, ModelOption, Trust, Usage } from "@switchback/protocol"
import type { TrustHint } from "../trustHint.js"
import { AsideChip } from "./aside-chip.js"
import { Bar } from "./ComposerBar.js"
import { nothingToSend } from "./composer-state.js"

interface Props {
  /** 历史会话：模型清单要接回之后才问得到，档位那行说明也是上一次进程的。 */
  detached: boolean
  /** 历史会话接不回来（见 `history-note.ts`）：发送键灰着，换一家引擎才能发。 */
  held: boolean
  busy: boolean
  starting: boolean
  attachmentBlocked: boolean
  text: string
  hasCommand: boolean
  attachments: number
  /** 输入框上方那排芯片有几枚。**它们也是「要发的东西」**——只挂一枚芯片
      一个字没打时，发送键不能是灰的。 */
  blocks: number
  engine: EngineId
  engines: readonly EngineInfo[]
  trust: Trust
  models: readonly ModelOption[]
  model: string | undefined
  effort: string | undefined
  usage: Usage | undefined
  pending: { label: string; onSwitchNow: () => void } | undefined
  hint: TrustHint | undefined
  blind: string | undefined
  aside: boolean
  onAsideExit: () => void
  /** 缩在这一排里的工作区芯片（分支、脏标、本轮已放行）。 */
  site: React.ReactNode
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onModelChange: (model: string, effort?: string) => void
  onAttach: () => void
  onInterrupt: (() => void) | undefined
  onSend: () => void
}

export function ComposerControls(props: Props): React.JSX.Element {
  return (
    <Bar
      detached={props.detached}
      held={props.held}
      busy={props.busy}
      starting={props.starting}
      empty={nothingToSend({
        attachmentBlocked: props.attachmentBlocked,
        text: props.text,
        hasCommand: props.hasCommand,
        attachments: props.attachments,
        blocks: props.blocks,
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
      aside={props.aside ? <AsideChip onExit={props.onAsideExit} /> : undefined}
      asideMode={props.aside}
      site={props.site}
      onModelChange={props.onModelChange}
      onAttach={props.onAttach}
      onInterrupt={props.onInterrupt}
      onSend={props.onSend}
    />
  )
}
