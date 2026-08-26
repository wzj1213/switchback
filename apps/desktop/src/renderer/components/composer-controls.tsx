import type { EngineId, EngineInfo, ModelOption, Trust, Usage } from "@omni/protocol"
import type { TrustHint } from "../trustHint.js"
import { AsideChip } from "./aside-chip.js"
import { Bar } from "./ComposerBar.js"
import { nothingToSend } from "./composer-state.js"

interface Props {
  detached: boolean
  busy: boolean
  starting: boolean
  attachmentBlocked: boolean
  text: string
  hasCommand: boolean
  attachments: number
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
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onModelChange: (model: string, effort?: string) => void
  onAttach: () => void
  onResume: () => void
  onInterrupt: (() => void) | undefined
  onSend: () => void
}

export function ComposerControls(props: Props): React.JSX.Element {
  return (
    <Bar
      detached={props.detached}
      busy={props.busy}
      starting={props.starting}
      empty={nothingToSend({
        attachmentBlocked: props.attachmentBlocked,
        text: props.text,
        hasCommand: props.hasCommand,
        attachments: props.attachments,
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
      onModelChange={props.onModelChange}
      onAttach={props.onAttach}
      onResume={props.onResume}
      onInterrupt={props.onInterrupt}
      onSend={props.onSend}
    />
  )
}
