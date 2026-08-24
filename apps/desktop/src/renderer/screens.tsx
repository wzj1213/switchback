import { useEffect, useState } from "react"
import type { Command, EngineInfo, Thread } from "@omni/protocol"
import { itemsOf, tasksOf, turnOf, type Notice as StoreNotice, type ViewState } from "@omni/store"
import { Notices } from "./components/Notices.js"
import { Compare, type ComparePane } from "./components/Compare.js"
import { SettingsPanel } from "./components/SettingsPanel.js"
import { SpinnerIcon } from "./components/icons.js"
import type { SettingsApi } from "./useSettings.js"
import { engineModelCatalogs } from "./engine-settings-model.js"

/**
 * 除主区之外的几块屏。
 *
 * 从 `App` 拆出来是行数闸门逼的，但边界是对的：`App` 只管**在哪几块之间切**，
 * 每一块自己长什么样是这里的事。
 */

/**
 * 空状态说什么。
 *
 * 有故障横幅时**不能**再说「正在打开工作区…」——那是句谎话，它永远不会打开，
 * 用户会一直等下去。一个会等到天亮的加载提示比一句直白的失败更糟。
 */
function emptyText(bridgeMissing: boolean, failed: boolean): string {
  if (bridgeMissing) {
    return "与主进程的通道没建立（preload 未注入）。界面此时点什么都不会有反应——先查主进程日志。"
  }
  if (failed) return "没有可用的会话。上方的故障说明了原因；处理好之后点「＋ 新建会话」重试。"
  return "正在打开工作区…"
}

/**
 * 一个会话都没有时的正文。
 *
 * **走 `.blank` 那一套，不借 `.reasoning`**：后者是转录区里 agent 的推理块，
 * 拿它画应用级的加载态是语义错配——将来调推理块的样式会莫名改到启动屏。
 *
 * 转圈只在「真的在等」那一支画：有故障横幅时它永远不会转完，
 * 而一个会等到天亮的加载提示比一句直白的失败更糟。
 */
function Notice({
  text,
  fatal,
  waiting,
}: {
  text: string
  fatal: boolean
  waiting: boolean
}): React.JSX.Element {
  if (fatal) {
    return (
      <div className="transcript">
        <div className="transcript__inner">
          <div className="error">{text}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="transcript">
      <div className="transcript__inner">
        <div className="blank">
          {waiting ? (
            <div className="blank__glyph blank__glyph--spin" aria-hidden="true">
              <SpinnerIcon size={34} />
            </div>
          ) : null}
          <p className="blank__title">{text}</p>
        </div>
      </div>
    </div>
  )
}

/** 一个会话都没有时的主区。故障横幅照样要显示——那往往正是没有会话的原因。 */
export function EmptyScreen({
  notices,
  onDismiss,
  bridgeMissing,
}: {
  notices: readonly StoreNotice[]
  onDismiss: (id: string) => void
  bridgeMissing: boolean
}): React.JSX.Element {
  return (
    <main className="main">
      {/* 一条会话都没有的那一屏：横幅照显，但没有会话可跳 */}
      <Notices notices={notices} rows={[]} onDismiss={onDismiss} onSelect={() => undefined} />
      <Notice
        fatal={bridgeMissing}
        waiting={!bridgeMissing && notices.length === 0}
        text={emptyText(bridgeMissing, notices.length > 0)}
      />
    </main>
  )
}

export function CompareScreen({
  state,
  engines,
  thread,
  peer,
  onCopy,
  onPick,
  onClose,
  send,
}: {
  state: ViewState
  engines: readonly EngineInfo[]
  thread: Thread
  peer: Thread
  onCopy: (text: string) => void
  onPick: (id: string) => void
  onClose: () => void
  send: (command: Command) => void
}): React.JSX.Element {
  const paneOf = (t: Thread): ComparePane => ({
    thread: t,
    items: itemsOf(state, t.id),
    turn: turnOf(state, t.id),
    tasks: tasksOf(state, t.id),
  })
  // 谁在左边由**创建先后**定，不是由「当前选中的是谁」定：
  // 从两边分别点进来看到的应该是同一张图，否则「左边那栏」这句话就没法说
  const [older, newer] = thread.createdAt <= peer.createdAt ? [thread, peer] : [peer, thread]
  return (
    <Compare
      a={paneOf(older)}
      b={paneOf(newer)}
      engines={engines}
      onCopy={onCopy}
      onPick={onPick}
      onClose={onClose}
      send={send}
    />
  )
}

/**
 * 设置屏。把「版本/数据目录」这两样异步拿到的东西留在这里，
 * 不塞进 `App`——它们只有这块面板用得着。
 */
export function SettingsScreen({
  prefs,
  engines,
  state,
  cwd,
  onReveal,
  onCopy,
  onClose,
}: {
  prefs: SettingsApi
  engines: readonly EngineInfo[]
  state: ViewState
  /** 当前会话的工作区。「环境」那页要按它算项目级的钩子；没有会话时是 undefined。 */
  cwd: string | undefined
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState({ version: "", dataDir: "" })
  const bridge = typeof window === "undefined" ? undefined : window.omni
  useEffect(() => {
    if (bridge === undefined) return
    void bridge.appInfo().then(setInfo)
  }, [bridge])
  return (
    <SettingsPanel
      settings={prefs.settings}
      engines={engines}
      catalog={state.engines}
      models={engineModelCatalogs(state, prefs.settings.dsh.profile)}
      accounts={state.accounts}
      version={info.version}
      dataDir={info.dataDir}
      cwd={cwd}
      onPatch={prefs.patch}
      onClose={onClose}
      onReveal={onReveal}
      onCopy={onCopy}
      onOpenEngines={() => {
        bridge?.openEngines()
      }}
      onDiagnose={() => {
        bridge?.diagnose()
      }}
    />
  )
}
