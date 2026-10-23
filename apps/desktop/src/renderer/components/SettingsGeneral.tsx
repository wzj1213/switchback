import type { EngineInfo, Trust } from "@switchback/protocol"
import type { NotifyMode, Settings } from "../../shared/settings.js"
import { trustsOf } from "../trusts.js"
import { Field, Group, Segmented, Toggle } from "./SettingsBits.js"
import { ThemeOptions } from "./theme-options.js"
import { useLocale, useMessages } from "../i18n.js"
import { GENERAL } from "./SettingsGeneral.messages.js"

/**
 * 「通用」与「新会话」两页。
 *
 * 它们是这块面板里**唯一真正独有的东西**——决定「Switchback 自己怎么表现」
 * 和「下一个新会话长什么样」，而在此之前后者只能每开一个会话手动改一次。
 */

export function LookSection({
  settings,
  onPatch,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  const m = useMessages(GENERAL)
  const notifyOptions = [
    { id: "all", label: m.notifyAll },
    { id: "approval", label: m.notifyApproval },
    { id: "off", label: m.notifyOff },
  ] as const
  const notifyHint: Readonly<Record<NotifyMode, string>> = {
    all: m.notifyHintAll,
    approval: m.notifyHintApproval,
    off: m.notifyHintOff,
  }
  return (
    <>
      <Group title={m.look}>
        <Field label={m.theme} stack>
          <ThemeOptions
            value={settings.theme}
            onPick={(theme) => {
              onPatch({ theme })
            }}
          />
        </Field>
      </Group>
      {/*
        这一组回答的是「它在背后跑完了，怎么让我知道」——这个应用的用法就是
        「交代一件事然后去干别的」，而在此之前**没有任何地方能把提醒关掉**。
      */}
      <Group title={m.notify}>
        {/* 不 stack：三个选项一共不到 200px，判据是**控件宽不宽**，不是这一项重不重要 */}
        <Field label={m.notifyScope} hint={notifyHint[settings.notify]}>
          <Segmented
            options={notifyOptions}
            value={settings.notify}
            onPick={(notify) => {
              onPatch({ notify })
            }}
          />
        </Field>
      </Group>
      {/*
        Switchback 往模型上下文里写话只有这一处（AGENTS.md 的那条例外），所以它必须是
        一个看得见、关得掉的开关，而且说清楚会发什么、落在哪。
      */}
      <Group title={m.switchEngine}>
        <Field
          label={m.autoHandoff}
          hint={
            settings.handoffBrief ? m.handoffOnHint : m.handoffOffHint
          }
          more={
            settings.handoffBrief ? m.handoffOnMore : m.handoffOffMore
          }
        >
          <Toggle
            label={m.handoffToggle}
            on={settings.handoffBrief}
            onChange={(handoffBrief) => {
              onPatch({ handoffBrief })
            }}
          />
        </Field>
      </Group>
    </>
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
  const m = useMessages(GENERAL)
  const trusts = trustsOf(useLocale())
  const selected = engines.some((engine) => engine.id === settings.defaultEngine)
    ? settings.defaultEngine
    : ""
  return (
    <Group title={m.newThreadDefaults} hint={m.newThreadHint}>
      {/*
        「跟上次」是默认，也是绝大多数人要的：挑一次引擎和模型，之后新会话就这么开。
        钉死一家是给「不管上次用了什么，我新会话永远从这家起」的人留的。
        记的时刻是**发出第一句话**那一下，中途换模型不算——见 `newThreadPrefs.ts`。
      */}
      <Field label={m.engine} hint={m.engineHint} stack>
        <Segmented
          options={[
            { id: "", label: m.sameAsLast },
            ...engines.map((e) => ({ id: e.id, label: e.label })),
          ]}
          value={selected}
          onPick={(defaultEngine) => {
            onPatch({ defaultEngine })
          }}
        />
      </Field>
      <Field
        label={m.trust}
        hint={m.trustHint}
        stack
      >
        <Segmented
          options={trusts.map((t) => ({ id: t.id, label: t.label }))}
          value={settings.defaultTrust}
          onPick={(defaultTrust) => {
            onPatch({ defaultTrust: defaultTrust as Trust })
          }}
        />
      </Field>
    </Group>
  )
}
