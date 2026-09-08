import type { EngineInfo, Trust } from "@omni/protocol"
import type { NotifyMode, Settings } from "../../shared/settings.js"
import { TRUSTS } from "./Composer.js"
import { Field, Group, Segmented } from "./SettingsBits.js"
import { ThemeOptions } from "./theme-options.js"

/**
 * 「通用」与「新会话」两页。
 *
 * 它们是这块面板里**唯一真正独有的东西**——决定「omni 自己怎么表现」
 * 和「下一个新会话长什么样」，而在此之前后者只能每开一个会话手动改一次。
 */

const NOTIFY = [
  { id: "all", label: "全部" },
  { id: "approval", label: "只有审批" },
  { id: "off", label: "关掉" },
] as const

const NOTIFY_HINT: Readonly<Record<NotifyMode, string>> = {
  all: "收到审批、完成或失败时通知。15 秒内完成的任务不会提醒。",
  approval: "仅在需要你审批时通知。",
  off: "关闭桌面和手机推送，Dock 角标仍显示待审批数量。",
}

export function LookSection({
  settings,
  onPatch,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  return (
    <>
      <Group title="外观">
        <Field label="主题" hint="选择工作台的显示方式" stack>
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
      <Group title="通知">
        {/* 不 stack：三个选项一共不到 200px，判据是**控件宽不宽**，不是这一项重不重要 */}
        <Field label="通知范围" hint={NOTIFY_HINT[settings.notify]}>
          <Segmented
            options={NOTIFY}
            value={settings.notify}
            onPick={(notify) => {
              onPatch({ notify })
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
      <Field label="引擎" hint="留空则跟着上次开工用的那家走（连模型和思维档一起）；这里只列已接入的那几家" stack>
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
