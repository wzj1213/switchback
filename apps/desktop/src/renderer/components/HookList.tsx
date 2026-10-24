import { shortPath, type HookLine, type HookSource } from "../../shared/hooks.js"
import type { Locale } from "@switchback/i18n"
import { useLocale, useMessages } from "../i18n.js"
import { HOOK_LIST } from "./HookList.messages.js"

/**
 * 一份配置文件、以及它里面的钩子。
 *
 * 从 `SettingsEnv` 拆出来是行数闸门逼的，但这一刀顺：那边管「哪几家、要不要展开」，
 * 这边管「一份配置画成什么样」。
 */

/** 一份配置文件。**没有这份文件时也要摆出来**——「这儿可以配」本身是信息。 */
export function SourceCard({ source, home }: { source: HookSource; home: string }): React.JSX.Element {
  const bridge = typeof window === "undefined" ? undefined : window.switchback
  const locale = useLocale()
  const m = HOOK_LIST[locale]
  return (
    <div className={`hk__src${source.exists ? "" : " hk__src--none"}`}>
      <div className="hk__head">
        <span className="hk__scope">{m.scope[source.scope]}</span>
        {/* 路径缩成 `~/…`，太长时省略尾部——**哪一份**由左边那个名字回答
            （「项目配置」/「本机私有配置」），省略号砍掉的不是识别它的依据。
            完整路径挂在 title 上 */}
        <code className="hk__path" title={source.path}>
          {shortPath(source.path, home)}
        </code>
        <span className="hk__sum">{summaryOf(source, locale)}</span>
        {source.exists ? (
          <button
            type="button"
            className="tbtn"
            onClick={() => {
              bridge?.openEnvFile(source.path)
            }}
          >
            {m.open}
          </button>
        ) : null}
      </div>
      {source.error === undefined ? null : <p className="hk__alarm">{m.parseFailed(source.error.format, source.error.detail)}</p>}
      {source.hooks.map((hook, i) => (
        <HookRow key={`${hook.event}-${String(i)}`} hook={hook} />
      ))}
    </div>
  )
}

/** 右边那句话。三种「空」的原因不一样，**说同一句等于什么都没说**。 */
export function summaryOf(source: HookSource, locale: Locale): string {
  const m = HOOK_LIST[locale]
  if (!source.exists) return m.missing
  if (source.hooks.length === 0) return m.empty
  const pending = source.hooks.filter((h) => h.trust === "pending").length
  const count = m.hooks(source.hooks.length)
  return pending === 0 ? count : m.withPending(count, pending)
}

/**
 * 一条钩子。**命令原文一定要摆出来**——「有 3 个钩子」回答不了
 * 「它会干什么」，而那正是人来这一页要看的东西。
 */
function HookRow({ hook }: { hook: HookLine }): React.JSX.Element {
  const m = useMessages(HOOK_LIST)
  const events: Readonly<Partial<Record<string, string>>> = m.event
  const text = events[hook.event]
  return (
    <div className="hk__row">
      <div className="hk__meta">
        <span className="hk__event">{hook.event}</span>
        {text === undefined ? null : <span className="hk__when">{text}</span>}
        {hook.matcher === undefined ? null : <span className="hk__match">{m.matcher(hook.matcher)}</span>}
        {hook.timeout === undefined ? null : <span className="hk__when">{m.timeout(hook.timeout)}</span>}
        {hook.trust === undefined ? null : (
          <span
            className={`hk__trust${hook.trust === "pending" ? " hk__trust--wait" : ""}`}
            title={
              hook.trust === "pending"
                ? m.pendingTip
                : m.trustedTip
            }
          >
            {hook.trust === "pending" ? m.pending : m.trusted}
          </span>
        )}
      </div>
      <code className="hk__cmd">{hook.command}</code>
      {hook.note === undefined ? null : <span className="hk__when">{hook.note}</span>}
    </div>
  )
}
