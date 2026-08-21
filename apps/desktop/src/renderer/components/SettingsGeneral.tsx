import type { EngineInfo, Trust } from "@omni/protocol"
import type { Settings } from "../useSettings.js"
import { TRUSTS } from "./Composer.js"
import { Field, Group, Segmented } from "./SettingsBits.js"

/**
 * 「外观」与「新会话」两页。
 *
 * 它们是这块面板里**唯一真正独有的东西**——决定「下一个新会话长什么样」，
 * 而在此之前只能每开一个会话手动改一次。
 */

const PETS = [
  { id: "on", label: "显示" },
  { id: "off", label: "隐藏" },
] as const

const THEMES = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
] as const

export function LookSection({
  settings,
  onPatch,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  return (
    <Group title="外观">
      <Field label="主题" hint="跟随系统时会随系统的深浅色切换">
        <Segmented
          options={THEMES}
          value={settings.theme}
          onPick={(theme) => {
            onPatch({ theme })
          }}
        />
      </Field>
      {/* 关掉是整块不渲染，不是藏起来——藏起来它照样占着指针事件那一层 */}
      <Field label="桌宠" hint="蹲在输入框上沿的那几只，一家引擎一只。能拖能扔，松手它自己回窝">
        <Segmented
          options={PETS}
          value={settings.pets ? "on" : "off"}
          onPick={(id) => {
            onPatch({ pets: id === "on" })
          }}
        />
      </Field>
    </Group>
  )
}

export function NewThreadSection({
  settings,
  engines,
  onPatch,
}: {
  settings: Settings
  engines: readonly EngineInfo[]
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  const selected = engines.some((engine) => engine.id === settings.defaultEngine)
    ? settings.defaultEngine
    : ""
  return (
    <Group title="新会话的默认" hint="只影响之后新开的会话，正开着的那些一个都不动。">
      {/*
        「跟上次」是默认，也是绝大多数人要的：挑一次引擎和模型，之后新会话就这么开。
        钉死一家是给「不管上次用了什么，我新会话永远从这家起」的人留的。
        记的时刻是**发出第一句话**那一下，中途换模型不算——见 `newThreadPrefs.ts`。
      */}
      <Field label="引擎" hint="留空则跟着上次开工用的那家走（连模型和思维档一起）" stack>
        <Segmented
          options={[
            { id: "", label: "跟上次" },
            ...engines.map((e) => ({ id: e.id, label: e.label })),
          ]}
          value={selected}
          onPick={(defaultEngine) => {
            onPatch({ defaultEngine })
          }}
        />
      </Field>
      <Field
        label="信任档"
        hint="决定新会话开在哪一档上。这是安全相关的默认值，改高之前想清楚"
        stack
      >
        <Segmented
          options={TRUSTS.map((t) => ({ id: t.id, label: t.label }))}
          value={settings.defaultTrust}
          onPick={(defaultTrust) => {
            onPatch({ defaultTrust: defaultTrust as Trust })
          }}
        />
      </Field>
    </Group>
  )
}
