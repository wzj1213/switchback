import { useMemo } from "react"
import type { DshProfile, DshProfileCatalog } from "../../main/dsh-profiles.js"
import type { Settings } from "../../shared/settings.js"
import { bridge, useAsync } from "../use-async.js"
import { Select, type Choice } from "./Select.js"
import { Actions, Blank, Field, Group } from "./SettingsBits.js"
import { EngineIcon, RevealIcon } from "./icons.js"

/**
 * DSH 的插件组装：一条 profile 就是一棵独立插件树。
 *
 * ## 为什么这里也用自绘下拉
 *
 * 这一栏原来是整块面板里**唯一一个原生 `<select>`**——而 `Select.tsx` 开头写着
 * 「替掉所有原生 select」。一个漏网的原生控件在深色模式下是系统色、
 * 弹出层是系统弹窗、字号和旁边差一档，看起来像是从另一个应用里抠出来的。
 *
 * omni 只选择并展示这棵树，**不代装插件、不改 DSH 的配置**。
 */
export function DshProfileSettings({
  settings,
  onPatch,
  onReveal,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const omni = bridge()
  const load = useMemo(() => (omni === undefined ? undefined : () => omni.dshProfiles()), [omni])
  const state = useAsync<DshProfileCatalog>(load)
  const profiles = state.data?.profiles ?? []
  const selected = profiles.find((profile) => profile.name === settings.dsh.profile)

  return (
    <Group
      title="DSH 插件组装"
      hint="一条 profile 就是一棵独立插件树。omni 只选择并展示它，不代装插件、不改 DSH 配置。"
    >
      <Field label="新会话 profile" hint="切换只影响之后新开的 DSH 会话；旧会话固定回到它创建时那棵树。">
        <Select
          label={settings.dsh.profile}
          icon={<EngineIcon />}
          title="新会话用哪棵插件树"
          sections={[{
            title: "profile",
            value: settings.dsh.profile,
            choices: choicesOf(profiles, settings.dsh.profile),
            onPick: (profile) => {
              onPatch({ dsh: { ...settings.dsh, profile } })
            },
          }]}
        />
      </Field>
      <Body state={state} profile={selected} profilesDir={state.data?.profilesDir} />
      <Actions>
        {selected === undefined ? null : (
          <button
            type="button"
            className="tbtn"
            onClick={() => {
              onReveal(selected.dir)
            }}
          >
            <RevealIcon size={13} /> 在访达中显示
          </button>
        )}
        <button
          type="button"
          className="tbtn"
          disabled={state.loading}
          onClick={() => {
            state.reload()
            // 重新探测：接入状态没变，但那棵树可能刚被装了新插件
            onPatch({ dsh: settings.dsh })
          }}
        >
          {state.loading ? "读取中…" : "重新读取并探测"}
        </button>
      </Actions>
    </Group>
  )
}

/** 不在目录里的那一条也要列出来：**它正是当前生效的值**，抹掉它等于让人以为自己没选过。 */
function choicesOf(profiles: readonly DshProfile[], current: string): readonly Choice[] {
  const known = profiles.map((profile) => ({
    id: profile.name,
    label: profile.name,
    ...(profile.valid ? {} : { note: "不可用" }),
  }))
  return known.some((choice) => choice.id === current)
    ? known
    : [...known, { id: current, label: current, note: "未发现" }]
}

function Body({ state, profile, profilesDir }: {
  state: { data?: DshProfileCatalog; loading: boolean; failed: boolean }
  profile: DshProfile | undefined
  profilesDir?: string
}): React.JSX.Element {
  if (state.failed) return <Blank tone="error">读取 DSH profiles 失败；点下面那颗可以再试一次。</Blank>
  if (state.data === undefined) return <Blank>正在读 profile manifest…</Blank>
  if (profile === undefined) {
    return <Blank tone="error">当前 profile 不在 {profilesDir ?? "DSH profiles 目录"} 中，不能启动。</Blank>
  }
  if (profile.error !== undefined) return <Blank tone="error">package.json 读不懂：{profile.error}</Blank>
  return (
    <div className="dsh-profile__map">
      <PluginLane title="组装层（按加载顺序）" empty="manifest 没有声明 bundle">
        {profile.bundles.map((bundle, index) => (
          <span className="dsh-plugin dsh-plugin--bundle" key={`${bundle}:${String(index)}`}>
            <b>{String(index + 1)}</b>{bundle}
          </span>
        ))}
      </PluginLane>
      <PluginLane title="直接依赖（由 profile 声明）" empty="没有额外的 profile 依赖">
        {profile.dependencies.map((dependency) => (
          <span className="dsh-plugin" key={dependency.name} title={dependency.version}>
            {dependency.name}<small>{dependency.version}</small>
          </span>
        ))}
      </PluginLane>
      <div className="dsh-profile__foot">
        <span>{profile.patchExists ? "检测到 cordis.patch.yml" : "没有 profile patch"}</span>
        <code title={profile.manifestPath}>{profile.manifestPath}</code>
      </div>
    </div>
  )
}

function PluginLane({ title, empty, children }: {
  title: string
  empty: string
  children: React.ReactNode
}): React.JSX.Element {
  const count = Array.isArray(children) ? children.length : 0
  return (
    <div className="dsh-profile__lane">
      <span className="dsh-profile__lane-title">{title}</span>
      <div className="dsh-profile__plugins">{count === 0 ? <em>{empty}</em> : children}</div>
    </div>
  )
}
