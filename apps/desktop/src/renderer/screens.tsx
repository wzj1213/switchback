import { useEffect, useState } from "react"
import type { Command, EngineInfo, Thread } from "@switchback/protocol"
import {
  itemsOf, lanesOf, pacesOf, tasksOf, thinkingTokensOf, turnOf,
  type Notice as StoreNotice, type ViewState,
} from "@switchback/store"
import { Notices } from "./components/Notices.js"
import { Compare, type ComparePane } from "./components/Compare.js"
import { SettingsPanel } from "./components/SettingsPanel.js"
import { SpinnerIcon } from "./components/icons.js"
import { AlertIcon } from "./components/icons-activity.js"
import type { SettingsApi } from "./useSettings.js"
import { engineModelCatalogs } from "./engine-settings-model.js"
import type { Locale } from "@switchback/i18n"
import { useLocale, useMessages } from "./i18n.js"
import { SCREENS } from "./screens.messages.js"

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
function emptyText(state: { bridgeMissing: boolean; failed: boolean; ready: boolean }, locale: Locale): string {
  const m = SCREENS[locale]
  if (state.bridgeMissing) return m.bridgeMissing
  if (state.failed) return m.failed
  return state.ready ? m.none : m.opening
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
  const m = useMessages(SCREENS)
  /*
   * **`.blank` 必须是 `.transcript` 的直接子元素。**
   *
   * 它靠 `min-height: 100%` + `justify-content: center` 在整块正文区里居中
   *（见 app-main.css），而百分比高度要求父级高度是确定的。上一版把它包进了
   * `.transcript__inner`——那是个高度 auto 的 flex 列，于是 `100%` 解析成 0，
   * **整段居中一天都没生效**：一句「正在打开工作区…」吊在左上角，
   * 底下空着七百像素。`Transcript.tsx` 里那个空态一直是直接子元素，所以只有这一屏错。
   *
   * 故障那一档仍然走 `.transcript__inner`：它是一段要读的正文，
   * 该和转录区里别的字共用同一条 780 的列。
   */
  if (fatal) {
    return (
      <div className="transcript" role="region" aria-label={m.region} tabIndex={0}>
        <div className="transcript__inner">
          <div className="failcard">
            <div className="failcard__head">
              <span className="failcard__icon"><AlertIcon size={14} /></span>
              <span className="failcard__title">{m.disconnected}</span>
            </div>
            <p className="failcard__text">{text}</p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="transcript" role="region" aria-label={m.region} tabIndex={0}>
      {/* 纯等待/纯状态：**两个方向都居中**。它没有下一步动作可以对齐——
          新会话那一屏靠左是因为你下一秒就要在同一条左缘上打字，这里没有那件事 */}
      <div className="blank blank--notice">
        {waiting ? (
          <div className="blank__glyph blank__glyph--spin" aria-hidden="true">
            <SpinnerIcon size={34} />
          </div>
        ) : null}
        <p className="blank__title">{text}</p>
      </div>
    </div>
  )
}

/** 一个会话都没有时的主区。故障横幅照样要显示——那往往正是没有会话的原因。 */
export function EmptyScreen({
  notices,
  onDismiss,
  onLogin,
  bridgeMissing,
  ready,
}: {
  notices: readonly StoreNotice[]
  onDismiss: (id: string) => void
  onLogin: () => void
  bridgeMissing: boolean
  ready: boolean
}): React.JSX.Element {
  const failed = notices.length > 0
  const locale = useLocale()
  return (
    <main className="main">
      {/* 顶栏那条线先在：主区一片空白、连边都没有的那一版看起来像应用坏了 */}
      <header className="topbar topbar--bare" />
      <Notices notices={notices} rows={[]} onDismiss={onDismiss} onSelect={() => undefined} onLogin={onLogin} />
      <Notice
        fatal={bridgeMissing}
        waiting={!bridgeMissing && !failed && !ready}
        text={emptyText({ bridgeMissing, failed, ready }, locale)}
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
    paces: pacesOf(state, t.id),
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
  initialTab,
  onReveal,
  onCopy,
  onClose,
}: {
  prefs: SettingsApi
  engines: readonly EngineInfo[]
  state: ViewState
  /** 当前会话的工作区。「环境」那页要按它算项目级的钩子；没有会话时是 undefined。 */
  cwd: string | undefined
  /** 打开时落在哪一页；不给就是第一页。 */
  initialTab?: string | undefined
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState({ version: "", dataDir: "" })
  const bridge = typeof window === "undefined" ? undefined : window.switchback
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
      {...(initialTab === undefined ? {} : { initialTab })}
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
