import type { EngineId, EngineInfo, ModelOption, Trust } from "@omni/protocol"
import { Action } from "./ComposerAction.js"
import { ModelPicker } from "./ModelPicker.js"
import { Select } from "./Select.js"
import { EngineIcon, ShieldIcon } from "./icons.js"
import { TRUSTS, labelOf } from "./Composer.js"

/**
 * 输入框下面那一排：引擎 / 信任档 / 模型 ＋ 右下角那颗键。
 *
 * 从 `Composer` 拆出来是行数闸门逼的。边界还算清楚：上面是「打什么字」，
 * 这一排是「这句话由谁、以什么权限、用哪个模型去跑」——
 * 四件事都不改文本，只改**这句话的去向**。
 */
export function Bar({
  detached,
  busy,
  empty,
  engine,
  engines,
  trust,
  models,
  model,
  effort,
  onEngineChange,
  onTrustChange,
  onModelChange,
  onResume,
  onInterrupt,
  onSend,
}: {
  detached: boolean
  busy: boolean
  empty: boolean
  engine: EngineId
  engines: readonly EngineInfo[]
  trust: Trust
  models: readonly ModelOption[]
  model?: string
  effort?: string
  onEngineChange: (next: EngineId) => void
  onTrustChange: (next: Trust) => void
  onModelChange: (model: string, effort?: string) => void
  onResume?: () => void
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  return (
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
            <Select
              label={labelOf(TRUSTS, trust)}
              icon={<ShieldIcon />}
              title="信任档"
              disabled={detached}
              sections={[
                {
                  value: trust,
                  onPick: (id) => {
                    onTrustChange(id as Trust)
                  },
                  choices: TRUSTS.map((item) => ({ id: item.id, label: item.label, description: item.hint })),
                },
              ]}
            />
            <ModelPicker
              models={models}
              model={model}
              effort={effort}
              disabled={detached}
              onChange={onModelChange}
            />
            <span style={{ flex: 1 }} />
            <Action
              detached={detached}
              busy={busy}
              empty={empty}
              onResume={onResume}
              onInterrupt={onInterrupt}
              onSend={onSend}
            />
          </div>
  )
}
