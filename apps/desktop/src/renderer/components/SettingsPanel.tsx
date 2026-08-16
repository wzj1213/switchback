import type { EngineInfo, Trust } from "@omni/protocol"
import type { Settings } from "../useSettings.js"
import { TRUSTS } from "./Composer.js"
import { EngineVersions } from "./EngineVersions.js"
import { CopyIcon, RevealIcon } from "./icons.js"

/**
 * 设置。
 *
 * ## 为什么是一块面板，不是又一个浮层
 *
 * 浮层适合「选一个然后关掉」。设置是**几组互不相干的选择**，
 * 而且用户会来回看、来回改——浮层一点外面就没了，改到一半手滑就得重来。
 *
 * ## 里面只放真的能改的东西
 *
 * 引擎注册表、诊断报告、检查更新这些**已经在菜单里**，这里只放链接过去的入口，
 * 不复制一份实现。摆两份实现的下场是其中一份迟早不更新。
 *
 * 主题、默认引擎、默认信任档是这里独有的——它们决定「下一个新会话长什么样」，
 * 而在此之前只能每开一个会话手动改一次。
 */

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="set__group">
      <h3 className="set__title">{title}</h3>
      {children}
    </section>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="set__field">
      <div className="set__text">
        <span className="set__label">{label}</span>
        {hint === undefined ? null : <span className="set__hint">{hint}</span>}
      </div>
      <div className="set__control">{children}</div>
    </div>
  )
}

/** 三段式开关。选项少且互斥时比下拉好：**三个都看得见，不用点开才知道有什么**。 */
function Segmented<T extends string>({
  options,
  value,
  onPick,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
}): React.JSX.Element {
  return (
    <div className="seg" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={`seg__item${option.id === value ? " seg__item--on" : ""}`}
          onClick={() => {
            onPick(option.id)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const THEMES = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
] as const

export interface SettingsPanelProps {
  settings: Settings
  engines: readonly EngineInfo[]
  version: string
  dataDir: string
  onPatch: (next: Partial<Settings>) => void
  onClose: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onOpenEngines: () => void
  onDiagnose: () => void
}

export function SettingsPanel(props: SettingsPanelProps): React.JSX.Element {
  const { settings, onPatch } = props
  return (
    <div
      className="set__scrim"
      role="presentation"
      onClick={(e) => {
        // 只有点到遮罩本身才关：点面板内部冒泡上来的不算，
        // 否则拖选一段文字松手在遮罩上也会把面板关掉
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="set" role="dialog" aria-label="设置">
        <header className="set__head">
          <span className="set__heading">设置</span>
          <span className="set__ver">omni {props.version}</span>
          <button type="button" className="iconbtn" aria-label="关闭" onClick={props.onClose}>
            ✕
          </button>
        </header>

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
        </Group>

        <Group title="新会话的默认">
          <Field label="引擎" hint="留空则沿用当前会话用的那家">
            <Segmented
              options={[{ id: "", label: "沿用当前" }, ...props.engines.map((e) => ({ id: e.id, label: e.label }))]}
              value={settings.defaultEngine}
              onPick={(defaultEngine) => {
                onPatch({ defaultEngine })
              }}
            />
          </Field>
          <Field label="信任档" hint="决定新会话开在哪一档上。这是安全相关的默认值，改高之前想清楚">
            <Segmented
              options={TRUSTS.map((t) => ({ id: t.id, label: t.label }))}
              value={settings.defaultTrust}
              onPick={(defaultTrust) => {
                onPatch({ defaultTrust: defaultTrust as Trust })
              }}
            />
          </Field>
        </Group>

        <Group title="引擎">
          <EngineVersions />
        </Group>

        <Group title="数据与排查">
          <Field label="数据目录" hint={props.dataDir}>
            <button
              type="button"
              className="tbtn"
              onClick={() => {
                props.onReveal(props.dataDir)
              }}
            >
              <RevealIcon /> 在访达中显示
            </button>
            <button
              type="button"
              className="tbtn"
              onClick={() => {
                props.onCopy(props.dataDir)
              }}
            >
              <CopyIcon /> 复制路径
            </button>
          </Field>
          <Field label="引擎注册表" hint="挂第三方 ACP 引擎，改完要重启 omni">
            <button type="button" className="tbtn" onClick={props.onOpenEngines}>
              打开 engines.json
            </button>
          </Field>
          <Field label="诊断报告" hint="版本、引擎探测、崩溃记录、日志尾部。不含会话内容">
            <button type="button" className="tbtn" onClick={props.onDiagnose}>
              导出…
            </button>
          </Field>
        </Group>
      </div>
    </div>
  )
}

