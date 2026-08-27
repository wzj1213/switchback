import { useEffect, useState } from "react"
import type { Command, EngineInfo, Thread } from "@omni/protocol"
import {
  itemsOf, lanesOf, tasksOf, thinkingTokensOf, turnOf,
  type Notice as StoreNotice, type ViewState,
} from "@omni/store"
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
 * 这一屏说什么。
 *
 * **「一条会话都没有」和「还没收到」是两件事。** 上一版把它们合成了一句
 * 「正在打开工作区…」，于是一个真的一条会话都没有的用户，对着一个
 * **永远转下去**的加载提示——而这个文件自己的注释早就写过那条判据：
 * 「一个会等到天亮的加载提示比一句直白的失败更糟」，只是当时没接住这一档。
 *
 * 现在四档：通道没建立 / 有故障 / 全量还没到（转圈）/ 真的一条都没有（给出路）。
 */
function emptyText(state: { bridgeMissing: boolean; failed: boolean; ready: boolean }): string {
  if (state.bridgeMissing) {
    return "与主进程的通道没建立（preload 未注入）。界面此时点什么都不会有反应——先查主进程日志。"
  }
  if (state.failed) return "没有可用的会话。上方的故障说明了原因；处理好之后点「＋ 新建会话」重试。"
  return state.ready ? "还没有会话" : "正在打开工作区…"
}

/**
 * 一个会话都没有时的正文。
 *
 * ## 为什么要把外壳画出来
 *
 * 上一版是**整块主区一片空白，正中一个转圈**。侧栏已经列着一排项目，右边却
 * 什么框都没有——那一屏看起来像应用坏了，而不是像它正在打开。**框架先在，
 * 只有对话主体那块显示加载**：顶栏那条线、正文区、输入框位置都摆着，
 * 于是加载完成时也不会整屏跳一下。
 *
 * 输入框那块**只画一个明显不可用的位子**，不画一个能点的假输入框——
 * 那时候没有会话，打进去的字无处可去（同「画一颗点了会炸的按钮比没有更糟」）。
 */
function Notice({ text, fatal, waiting }: {
  text: string
  fatal: boolean
  waiting: boolean
}): React.JSX.Element {
  return (
    <div className="transcript" role="region" aria-label="应用状态" tabIndex={0}>
      <div className="transcript__inner">
        {fatal ? (
          <div className="error">{text}</div>
        ) : (
          <div className="blank">
            {waiting ? (
              <div className="blank__glyph blank__glyph--spin" aria-hidden="true">
                <SpinnerIcon size={34} />
              </div>
            ) : null}
            <p className="blank__title">{text}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** 一个会话都没有时的主区。故障横幅照样要显示——那往往正是没有会话的原因。 */
export function EmptyScreen({
  notices,
  onDismiss,
  bridgeMissing,
  ready,
}: {
  notices: readonly StoreNotice[]
  onDismiss: (id: string) => void
  bridgeMissing: boolean
  ready: boolean
}): React.JSX.Element {
  const failed = notices.length > 0
  return (
    <main className="main">
      {/* 顶栏那条线先在：主区一片空白、连边都没有的那一版看起来像应用坏了 */}
      <header className="topbar topbar--bare" />
      <Notices notices={notices} rows={[]} onDismiss={onDismiss} onSelect={() => undefined} />
      <Notice
        fatal={bridgeMissing}
        waiting={!bridgeMissing && !failed && !ready}
        text={emptyText({ bridgeMissing, failed, ready })}
      />
      {/* 输入框的位子。**只是个位子**——没有会话时打进去的字无处可去 */}
      <div className="composer composer--waiting" aria-hidden="true">
        <div className="composer__inner" />
      </div>
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
    thinkingTokens: thinkingTokensOf(state, t.id),
    lanes: lanesOf(state, t.id),
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
