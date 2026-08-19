import { useState } from "react"
import type { EngineInfo } from "@omni/protocol"
import type { Settings } from "../useSettings.js"
import { useModalKeys } from "../useModalKeys.js"
import { LookSection, NewThreadSection } from "./SettingsGeneral.js"
import { DataSection, EnginesSection } from "./SettingsData.js"
import { EnvSection } from "./SettingsEnv.js"
import { RemotePanel } from "./RemotePanel.js"
import { EngineIcon, FolderIcon, PlusIcon, SparkIcon } from "./icons.js"
import { GlobeIcon, TerminalIcon } from "./icons-activity.js"

/**
 * 设置。
 *
 * ## 为什么是一块面板，不是又一个浮层
 *
 * 浮层适合「选一个然后关掉」。设置是**几组互不相干的选择**，
 * 而且用户会来回看、来回改——浮层一点外面就没了，改到一半手滑就得重来。
 *
 * ## 为什么改成左边一列分页
 *
 * 原来是一根 560px 宽的长条，所有组从上到下排。两个后果：
 *
 * 1. **挤。** 每行「左说明 / 右控件」，而五家引擎并排的那个开关占掉大半行宽，
 *    左边那句说明被压成每行两三个字的竖条。
 * 2. **卡。** 一打开就把每一组都挂上，其中「引擎版本」那组会去 spawn
 *    `codex --version` 和 `npm view`——每开一次设置顿一下，
 *    而顿的原因和你当时想做的事（改个主题）毫无关系。
 *
 * 分页把两件事一起解决：宽度够了说明就能写全，而**没点到的那一页根本不挂载**，
 * 环境那页要读盘、引擎那页要探版本，都只在你真的点进去时才发生。
 * 面板尺寸也就固定了下来——内容后到不会再把面板撑高一截（那一跳同样像「卡了一下」）。
 *
 * ## 里面只放真的能改的东西
 *
 * 引擎注册表、诊断报告这些**已经在菜单里**，这里只放链接过去的入口，不复制实现。
 */

const TABS = [
  { id: "look", label: "外观", icon: <SparkIcon size={14} /> },
  { id: "new", label: "新会话", icon: <PlusIcon size={14} /> },
  { id: "engines", label: "引擎", icon: <EngineIcon size={14} /> },
  { id: "env", label: "环境", icon: <TerminalIcon size={14} /> },
  // 排在「数据与排查」前面：它是一件要**开**的事，而那一页是出问题时才去的
  { id: "remote", label: "远程访问", icon: <GlobeIcon size={14} /> },
  { id: "data", label: "数据与排查", icon: <FolderIcon size={14} /> },
] as const

type TabId = (typeof TABS)[number]["id"]

export interface SettingsPanelProps {
  settings: Settings
  engines: readonly EngineInfo[]
  version: string
  dataDir: string
  /** 当前会话的工作区。「环境」那页要靠它算项目级的配置；没有会话时就只有用户级那几份。 */
  cwd?: string
  onPatch: (next: Partial<Settings>) => void
  onClose: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onOpenEngines: () => void
  onDiagnose: () => void
}

/** 哪一页画什么。抽成取值函数是行数闸门，但边界也对：面板只管「切哪一页」。 */
function paneOf(tab: TabId, props: SettingsPanelProps): React.JSX.Element {
  const { settings, onPatch } = props
  if (tab === "look") return <LookSection settings={settings} onPatch={onPatch} />
  if (tab === "new") return <NewThreadSection settings={settings} engines={props.engines} onPatch={onPatch} />
  if (tab === "engines")
    return <EnginesSection cwd={props.cwd} onOpenEngines={props.onOpenEngines} onReveal={props.onReveal} />
  if (tab === "env") return <EnvSection cwd={props.cwd} />
  if (tab === "remote") return <RemotePanel settings={settings} onPatch={onPatch} />
  return (
    <DataSection
      dataDir={props.dataDir}
      onReveal={props.onReveal}
      onCopy={props.onCopy}
      onDiagnose={props.onDiagnose}
    />
  )
}

export function SettingsPanel(props: SettingsPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<TabId>("look")
  // 这是最上层的模态，却曾经是唯一按 Esc 关不掉的浮层（见 `useModalKeys`）
  const box = useModalKeys(props.onClose)
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
      <div className="set" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="设置">
        <header className="set__head">
          <span className="set__heading">设置</span>
          <span className="set__ver">omni {props.version}</span>
          <button type="button" className="iconbtn" aria-label="关闭" onClick={props.onClose}>
            ✕
          </button>
        </header>
        <div className="set__body">
          <nav className="set__nav" aria-label="设置分类">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={t.id === tab}
                className={`set__tab${t.id === tab ? " set__tab--on" : ""}`}
                onClick={() => {
                  setTab(t.id)
                }}
              >
                <span className="set__tabicon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
          {/* key 按分页隔离：切走再切回来是**重新开始**（环境那页会重新读盘），
              而不是接着上一次的半截状态 */}
          <div className="set__pane" key={tab}>
            {paneOf(tab, props)}
          </div>
        </div>
      </div>
    </div>
  )
}
