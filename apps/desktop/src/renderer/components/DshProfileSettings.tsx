import { useEffect, useState } from "react"
import type { DshProfile, DshProfileCatalog } from "../../main/dsh-profiles.js"
import type { Settings } from "../../shared/settings.js"
import { Field, Group } from "./SettingsBits.js"
import { RevealIcon } from "./icons.js"

interface LoadState {
  catalog?: DshProfileCatalog
  failed: boolean
}

export function DshProfileSettings({
  settings,
  onPatch,
  onReveal,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<LoadState>({ failed: false })
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    let live = true
    setState({ failed: false })
    void bridge?.dshProfiles().then(
      (catalog) => {
        if (live) setState({ catalog, failed: false })
      },
      () => {
        if (live) setState({ failed: true })
      },
    )
    return () => {
      live = false
    }
  }, [bridge, reload])

  const profiles = state.catalog?.profiles ?? []
  const selected = profiles.find((profile) => profile.name === settings.dsh.profile)
  return (
    <Group
      title="DSH 插件组装"
      hint="一条 profile 就是一棵独立插件树。omni 只选择并展示它，不代装插件、不改 DSH 配置。"
    >
      <Field label="新会话 profile" hint="切换只影响之后新开的 DSH 会话；旧会话固定回到原 profile。">
        <select
          className="dsh-profile__select"
          value={settings.dsh.profile}
          onChange={(event) => {
            onPatch({ dsh: { ...settings.dsh, profile: event.target.value } })
          }}
        >
          {selected === undefined ? <option value={settings.dsh.profile}>{settings.dsh.profile}（未发现）</option> : null}
          {profiles.map((profile) => (
            <option key={profile.name} value={profile.name} disabled={!profile.valid}>
              {profile.name}{profile.valid ? "" : "（不可用）"}
            </option>
          ))}
        </select>
      </Field>
      <ProfileBody state={state} profile={selected} profilesDir={state.catalog?.profilesDir} />
      <div className="dsh-profile__actions">
        <button
          type="button"
          className="tbtn"
          onClick={() => {
            setReload((value) => value + 1)
            onPatch({ dsh: settings.dsh })
          }}
        >
          重新读取并探测
        </button>
        {selected === undefined ? null : (
          <button type="button" className="tbtn" onClick={() => onReveal(selected.dir)}>
            <RevealIcon size={13} /> 在访达中显示
          </button>
        )}
      </div>
    </Group>
  )
}

function ProfileBody({ state, profile, profilesDir }: {
  state: LoadState
  profile: DshProfile | undefined
  profilesDir?: string
}): React.JSX.Element {
  if (state.catalog === undefined && !state.failed) return <p className="dsh-profile__empty">正在读取 profile manifest…</p>
  if (state.failed) return <p className="dsh-profile__error">读取 DSH profiles 失败；稍后可以重新读取。</p>
  if (profile === undefined) {
    return <p className="dsh-profile__error">当前 profile 不在 {profilesDir ?? "DSH profiles 目录"} 中，不能启动。</p>
  }
  if (profile.error !== undefined) {
    return <p className="dsh-profile__error">package.json 读不懂：{profile.error}</p>
  }
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
