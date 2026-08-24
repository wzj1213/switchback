import { useRef, useState } from "react"
import type { EngineAccount, EngineInfo, ModelOption } from "@omni/protocol"
import { dshProfileConfirmed, type Settings } from "../../shared/settings.js"
import {
  engineSettingState,
  engineSettingItems,
  initialEngine,
  withEnginePick,
  type EngineSettingItem,
} from "../engine-settings-model.js"
import { settingsCopyOf } from "../engine-settings-copy.js"
import { EngineNative } from "./EngineNative.js"
import { EngineOmniSettings } from "./EngineOmniSettings.js"
import { EnginePreference } from "./EnginePreference.js"
import { Field, Group } from "./SettingsBits.js"
import { DshProfileSettings } from "./DshProfileSettings.js"

export function EnginesSection({
  settings,
  catalog,
  models,
  accounts,
  cwd,
  onPatch,
  onCopy,
  onOpenEngines,
  onReveal,
}: {
  settings: Settings
  catalog: readonly EngineInfo[]
  models: Readonly<Record<string, readonly ModelOption[]>>
  accounts: Readonly<Record<string, EngineAccount>>
  cwd: string | undefined
  onPatch: (next: Partial<Settings>) => void
  onCopy: (text: string) => void
  onOpenEngines: () => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const items = engineSettingItems(catalog)
  const root = useRef<HTMLElement>(null)
  const [selected, setSelected] = useState(() =>
    initialEngine(items, settings.defaultEngine, settings.lastUsed.engine),
  )
  const item = items.find((candidate) => candidate.id === selected) ?? items[0]
  if (item === undefined) return <p className="set__blank">还没有可配置的引擎。</p>
  const state = engineSettingState(item, settings)
  const copy = settingsCopyOf(item.id)
  const connected = item.id !== "dsh" || dshProfileConfirmed(settings.dsh)
  const showEngine = (id: string): void => {
    setSelected(id)
    root.current?.closest<HTMLElement>(".set__pane")?.scrollTo({ top: 0 })
  }

  return (
    <section ref={root} className="eng-settings" aria-label="引擎配置">
      <EngineTabs items={items} active={item.id} settings={settings} onSelect={showEngine} />
      <div id="engine-settings-panel" className="eng-panel">
        <header className="eng-head">
          <div>
            <h2>{item.label}</h2>
            <p>{copy.summary}</p>
          </div>
          <span className={`eng-status eng-status--${state.tone}`}>{state.label}</span>
        </header>
        {item.id === "dsh" ? (
          <DshProfileSettings settings={settings} onPatch={onPatch} onReveal={onReveal} />
        ) : null}
        <EngineOmniSettings
          item={item}
          state={state}
          settings={settings}
          account={accounts[item.id]}
          onPatch={onPatch}
        />
        <Group
          title="新会话的模型与思考档"
          hint="平时会记住这家上一次开工时的选择；这里可以直接改，也可以退回引擎默认。"
        >
          <Field label="沿用配置" hint="只影响之后新开的会话；当前会话不会被重启" stack>
            <EnginePreference
              pick={settings.lastUsed.byEngine[item.id]}
              models={models[item.id] ?? []}
              disabled={!connected}
              onPick={(pick) => {
                onPatch({ lastUsed: withEnginePick(settings.lastUsed, item.id, pick) })
              }}
            />
          </Field>
        </Group>
        <EngineNative
          engine={item.id}
          dshProfile={item.id === "dsh" ? settings.dsh.profile : undefined}
          copy={copy}
          cwd={cwd}
          onCopy={onCopy}
          onOpenEngines={onOpenEngines}
          onReveal={onReveal}
        />
      </div>
    </section>
  )
}

function EngineTabs({
  items,
  active,
  settings,
  onSelect,
}: {
  items: readonly EngineSettingItem[]
  active: string
  settings: Settings
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="eng-tabs" role="group" aria-label="选择引擎">
      {items.map((item) => {
        const state = engineSettingState(item, settings)
        const pinned = settings.defaultEngine === item.id
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === active}
            aria-controls="engine-settings-panel"
            aria-label={`${item.label}，${state.label}${pinned ? "，新会话默认" : ""}`}
            title={`${item.label} · ${state.label}`}
            className={`eng-tab${item.id === active ? " eng-tab--on" : ""}`}
            onClick={() => {
              onSelect(item.id)
            }}
          >
            <span className={`eng-dot eng-dot--${state.tone}`} aria-hidden="true" />
            <span>{item.label}</span>
            {pinned ? <span className="eng-tab__default">默认</span> : null}
          </button>
        )
      })}
    </div>
  )
}
