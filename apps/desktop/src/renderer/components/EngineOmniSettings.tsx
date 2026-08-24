import type { EngineAccount } from "@omni/protocol"
import { dshProfileConfirmed, type Settings } from "../../shared/settings.js"
import type { EngineSettingItem, EngineSettingState } from "../engine-settings-model.js"
import { Field, Group, Segmented } from "./SettingsBits.js"

export function EngineOmniSettings({
  item,
  state,
  settings,
  account,
  onPatch,
}: {
  item: EngineSettingItem
  state: EngineSettingState
  settings: Settings
  account: EngineAccount | undefined
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  const isDefault = settings.defaultEngine === item.id
  const connected = item.id !== "dsh" || dshProfileConfirmed(settings.dsh)
  return (
    <Group title="在 omni 中">
      {item.id === "dsh" ? (
        <Field
          label="接入状态"
          hint={`确认 ${settings.dsh.profile} 已在 DSH Web 配好 Provider、模型与凭证；确认只对这个 profile 生效。`}
        >
          <Segmented
            options={DSH_STATE}
            value={connected ? "ready" : "pending"}
            onPick={(value) => {
              const confirmed = new Set(settings.dsh.confirmedProfiles)
              if (value === "ready") confirmed.add(settings.dsh.profile)
              else confirmed.delete(settings.dsh.profile)
              onPatch({ dsh: { ...settings.dsh, confirmedProfiles: [...confirmed] } })
            }}
          />
        </Field>
      ) : null}
      <Field label="运行状态" hint={state.hint}>
        <span className={`eng-readout eng-readout--${state.tone}`}>{state.label}</span>
      </Field>
      <Field label="账号" hint={accountHint(account)}>
        <span className="eng-readout">{account?.label ?? "未报告"}</span>
      </Field>
      <Field label="新会话默认" hint="钉死这家，或继续跟随你上一次实际开工用的引擎。">
        <button
          type="button"
          className={`tbtn${isDefault ? " tbtn--on" : ""}`}
          disabled={!connected && !isDefault}
          onClick={() => onPatch({ defaultEngine: isDefault ? "" : item.id })}
        >
          {isDefault ? "改回跟上次" : "设为默认"}
        </button>
      </Field>
    </Group>
  )
}

function accountHint(account: EngineAccount | undefined): string {
  if (account === undefined) return "这家没有向 omni 报告账号；这不等于未登录。"
  return account.plan === undefined ? "由引擎自己报告" : `由引擎自己报告 · ${account.plan}`
}

const DSH_STATE = [
  { id: "pending", label: "未配置" },
  { id: "ready", label: "已配置" },
] as const
