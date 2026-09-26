import { useRef, useState } from "react"
import type { EngineAccount, EngineInfo, ModelOption } from "@omni/protocol"
import { lastEnabledEngine } from "../../shared/engine-access.js"
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
  onReveal,
  onGoInstall,
}: {
  settings: Settings
  catalog: readonly EngineInfo[]
  models: Readonly<Record<string, readonly ModelOption[]>>
  accounts: Readonly<Record<string, EngineAccount>>
  cwd: string | undefined
  onPatch: (next: Partial<Settings>) => void
  onCopy: (text: string) => void
  onReveal: (path: string) => void
  /** 「装一家、升级、接一家新的」都在另一页；这里给一条过去的路。 */
  onGoInstall: () => void
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
  const off = settings.disabledEngines.includes(item.id)
  const connected = !off && (item.id !== "dsh" || dshProfileConfirmed(settings.dsh))
  const locked = lastEnabledEngine(settings, items.map((entry) => entry.id)) === item.id
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
        <EngineOmniSettings
          item={item}
          state={state}
          settings={settings}
          account={accounts[item.id]}
          locked={locked}
          onPatch={onPatch}
        />
        {item.id === "dsh" ? (
          <DshProfileSettings settings={settings} onPatch={onPatch} onReveal={onReveal} />
        ) : null}
        <Group
          title="新会话的模型与思考档"
          hint="平时会记住这家上一次开工时的选择；这里可以直接改，也可以退回引擎默认。"
        >
          <Field
            label="沿用配置"
            hint={(models[item.id] ?? []).length === 0
              ? "先用这家开过会话，才会列出它自己报告的模型"
              : "只影响之后新开的会话，当前会话不会被重启。选项是这家引擎本次实际报告的清单"}
          >
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
          onReveal={onReveal}
        />
      </div>
      {/*
        装 / 升级 / 接一家新的搬到了「安装与接入」那一页（理由见 `SettingsPanel`
        的 TABS）。**但要留一条路过去**：一个人是先想到「我要用 codex」才想到
        「哦它没装」的，而那一刻他人在这一页。
      */}
      <div className="eng-registry">
        <span>装一家、升级到新版、或者接一家 omni 还不认识的 ACP 引擎——都在「安装与接入」。</span>
        <button type="button" className="tbtn" onClick={onGoInstall}>
          去那儿
        </button>
      </div>
    </section>
  )
}

/**
 * 上沿那排引擎。
 *
 * 每一颗带一个状态点，**关掉的那几家整颗压暗**——不是移走：
 * 「这家我关了」和「omni 不知道有这家」在界面上必须分得出来，
 * 而移走之后就没有任何地方能把它开回来了。
 */
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
        const off = settings.disabledEngines.includes(item.id)
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === active}
            aria-controls="engine-settings-panel"
            aria-label={`${item.label}，${state.label}${pinned ? "，新会话默认" : ""}`}
            title={`${item.label} · ${state.label}`}
            className={`eng-tab${item.id === active ? " eng-tab--on" : ""}${off ? " eng-tab--off" : ""}`}
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
