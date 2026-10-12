import { Suspense, useState } from "react"
import { CloseIcon } from "./icons-panel.js"
import type { EngineAccount, EngineInfo, ModelOption } from "@switchback/protocol"
import type { Settings } from "../useSettings.js"
import { useModalKeys } from "../useModalKeys.js"
import { LookSection, NewThreadSection } from "./SettingsGeneral.js"
import { DataSection, EnginesSection, EnvSection, ActivitySection, RemotePanel, PetsSection, EngineShared, GuardSection } from "./deferred-settings.js"
import { ChartIcon, EngineIcon, PetIcon, PlusIcon, SparkIcon, ToBottomIcon } from "./icons.js"
import { FolderIcon } from "./icons-folder.js"
import { GlobeIcon, TerminalIcon } from "./icons-activity.js"
import { isRemote } from "../remote/where.js"

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
 * 环境那页要读盘、引擎那页要探版本、活动那页要把整份 journal 走一遍，
 * 都只在你真的点进去时才发生。面板尺寸也就固定了下来——内容后到不会再把面板
 * 撑高一截（那一跳同样像「卡了一下」）。
 *
 * ## 左列为什么分成两段
 *
 * 上面那几页**改东西**，下面那几页**看东西**（活动统计、数据与排查）。
 * 这条界限不是分类癖：一个人打开设置时心里只有两种意图之一，
 * 而在一列七项里挨个读标题，比先看一眼分成两堆慢。
 *
 * ## 引擎页怎么分边界
 *
 * 接入开关、新会话默认、各家的模型/思考档与 DSH 接入确认由 Switchback 直接画控件——
 * 它们全都只改 Switchback 自己的行为。认证、Provider、API Key 与厂商高级项继续走原生入口，
 * 不把密钥读进 renderer，也不复制一份随版本漂移的厂商配置协议。
 */

const TABS = [
  { id: "look", label: "通用", icon: <SparkIcon size={14} /> },
  // 排在通用后面：桌宠是**外观**。它既不属于后面那几件「要开的事」，
  // 也不属于分界线下面「拿来看的东西」
  { id: "pets", label: "桌宠", icon: <PetIcon size={14} /> },
  { id: "new", label: "新会话", icon: <PlusIcon size={14} /> },
  { id: "engines", label: "引擎", icon: <EngineIcon size={14} /> },
  /*
   * **和「引擎」分开的两个理由，第二个是硬的。**
   *
   * ① 引擎页上沿那条 tab 条是 sticky 的——它在视觉上宣告了「下面这些属于选中
   *    的那一家」。把一块不归它管的东西压在它作用域里，等于把「散落在五个 tab
   *    里」改成「藏在一个 tab 底下」，问题只搬了个家。
   *
   * ② **它要 spawn 一串子进程。** 这一组会去跑 `codex --version` 和 `npm view`
   *    （见本文件开头那段：分页正是为了「没点到的那一页根本不挂载」）。
   *    挂在引擎页上的话，每次进去改个默认模型都白付一次这个代价——
   *    而那才是引擎页真正的日常用途。
   */
  { id: "install", label: "安装与接入", icon: <ToBottomIcon size={14} /> },
  { id: "env", label: "环境", icon: <TerminalIcon size={14} /> },
  // 排在「看东西」那一段之前：它是一件要**开**的事
  { id: "remote", label: "远程访问", icon: <GlobeIcon size={14} /> },
  { id: "activity", label: "活动", icon: <ChartIcon size={14} />, look: true },
  { id: "data", label: "数据与排查", icon: <FolderIcon size={14} />, look: true },
] as const

type TabId = (typeof TABS)[number]["id"]

/**
 * 远程窗口里不摆的几页：它们管的是**宿主这台机器本身**——装引擎与接入、开远程访问、
 * 数据目录与诊断。另一台电脑上点下去，事情发生在宿主的屏幕上（`remote/where.ts`）。
 */
const HOST_TABS: ReadonlySet<string> = new Set(["install", "remote", "data"])

/** 这扇窗摆哪几页。远程窗口在一页的生命周期里不会变成本机窗口，算一次就够。 */
function tabsHere(): readonly (typeof TABS)[number][] {
  return isRemote() ? TABS.filter((tab) => !HOST_TABS.has(tab.id)) : TABS
}

export interface SettingsPanelProps {
  settings: Settings
  engines: readonly EngineInfo[]
  /** 未经过接入过滤的宿主清单；设置页要照实显示未安装状态与第三方引擎。 */
  catalog: readonly EngineInfo[]
  models: Readonly<Record<string, readonly ModelOption[]>>
  accounts: Readonly<Record<string, EngineAccount>>
  version: string
  dataDir: string
  /** 当前会话的工作区。「环境」那页要靠它算项目级的配置；没有会话时就只有用户级那几份。 */
  cwd?: string
  /** 打开时落在哪一页（「需要登录」横幅直接落到「安装与接入」）。认不出的就从第一页开始。 */
  initialTab?: string
  onPatch: (next: Partial<Settings>) => void
  onClose: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onOpenEngines: () => void
  onDiagnose: () => void
}

/** 引擎 id → 人话名。第三方引擎的名字只有宿主的清单知道，认不出就照实显示 id。 */
function engineNamer(catalog: readonly EngineInfo[]): (id: string) => string {
  const names = new Map(catalog.map((engine) => [engine.id, engine.label]))
  return (id) => names.get(id) ?? id
}

/** 哪一页画什么。抽成取值函数是行数闸门，但边界也对：面板只管「切哪一页」。 */
function paneOf(tab: TabId, props: SettingsPanelProps, go: (id: TabId) => void): React.JSX.Element {
  const { settings, onPatch } = props
  if (tab === "look") return <LookSection settings={settings} onPatch={onPatch} />
  if (tab === "pets")
    return <PetsSection settings={settings} engines={props.catalog} onPatch={onPatch} />
  if (tab === "new")
    return <NewThreadSection settings={settings} engines={props.engines} onPatch={onPatch} />
  if (tab === "engines")
    return (
      <EnginesSection
        settings={settings}
        catalog={props.catalog}
        models={props.models}
        accounts={props.accounts}
        cwd={props.cwd}
        onPatch={onPatch}
        onCopy={props.onCopy}
        onReveal={props.onReveal}
        onGoInstall={() => {
          go("install")
        }}
      />
    )
  if (tab === "install")
    return <EngineShared onCopy={props.onCopy} onOpenEngines={props.onOpenEngines} />
  if (tab === "env") return <EnvSection cwd={props.cwd} />
  if (tab === "remote") return <RemotePanel settings={settings} onPatch={onPatch} />
  if (tab === "activity")
    return (
      <ActivitySection
        engineName={engineNamer(props.catalog)}
        dataDir={props.dataDir}
        now={Date.now()}
      />
    )
  return (
    <>
      <GuardSection settings={settings} onPatch={onPatch} onReveal={props.onReveal} />
      <DataSection
        dataDir={props.dataDir}
        onReveal={props.onReveal}
        onCopy={props.onCopy}
        onDiagnose={props.onDiagnose}
        onOpenEngines={props.onOpenEngines}
      />
    </>
  )
}

function Nav({ tab, onPick }: { tab: TabId; onPick: (id: TabId) => void }): React.JSX.Element {
  const tabs = tabsHere()
  // 「看东西」那一段从第几项起（远程窗口少了几页，所以按摆出来的那份数）
  const cut = tabs.findIndex((one) => "look" in one)
  return (
    <nav className="set__nav" aria-label="设置分类">
      {tabs.map((t, index) => (
        <button
          key={t.id}
          type="button"
          aria-current={t.id === tab}
          // 「看东西」那一段之前画一条分隔：先分两堆，比在七项里挨个读标题快
          className={`set__tab${t.id === tab ? " set__tab--on" : ""}${index === cut ? " set__tab--cut" : ""}`}
          onClick={() => {
            onPick(t.id)
          }}
        >
          <span className="set__tabicon">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

export function SettingsPanel(props: SettingsPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<TabId>(() => tabsHere().find((one) => one.id === props.initialTab)?.id ?? "look")
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
      <div
        className="set"
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        {/* 标题收进左列顶上：上一版在整块面板上面横着压了一条 60px 的抬头，
            只写着「设置」和版本号，而左列选中的那一项本来就说明了你在哪儿 */}
        {/* 关闭键浮在右上角，但在 DOM 里排第一个：键盘进来先碰到的还是它 */}
        <button type="button" className="iconbtn set__close" aria-label="关闭" data-tip="关闭设置（Esc）" onClick={props.onClose}>
          <CloseIcon />
        </button>
        <div className="set__body">
          <div className="set__side">
            <div className="set__brand">
              <span className="set__heading">设置</span>
              <span className="set__ver">Switchback {props.version}</span>
            </div>
            <Nav tab={tab} onPick={setTab} />
          </div>
          {/* key 按分页隔离：切走再切回来是**重新开始**（环境那页会重新读盘），
              而不是接着上一次的半截状态 */}
          <div className="set__pane" key={tab}>
            {/* 页标题那一条吸顶：右上角的关闭键就落在这条带子里，内容滚上来从它底下过，
                不会再和关闭键叠在一起 */}
            <div className="set__pagehead">
              <h2 className="set__page-title">{TABS.find((entry) => entry.id === tab)?.label}</h2>
            </div>
            <Suspense fallback={<p className="set__loading" role="status">正在加载设置…</p>}>
              {paneOf(tab, props, setTab)}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
