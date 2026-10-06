import { EVENT_TEXT, SCOPE_TEXT, shortPath, type HookLine, type HookSource } from "../../shared/hooks.js"

/**
 * 一份配置文件、以及它里面的钩子。
 *
 * 从 `SettingsEnv` 拆出来是行数闸门逼的，但这一刀顺：那边管「哪几家、要不要展开」，
 * 这边管「一份配置画成什么样」。
 */

/** 一份配置文件。**没有这份文件时也要摆出来**——「这儿可以配」本身是信息。 */
export function SourceCard({ source, home }: { source: HookSource; home: string }): React.JSX.Element {
  const bridge = typeof window === "undefined" ? undefined : window.switchback
  return (
    <div className={`hk__src${source.exists ? "" : " hk__src--none"}`}>
      <div className="hk__head">
        <span className="hk__scope">{SCOPE_TEXT[source.scope]}</span>
        {/* 路径缩成 `~/…`，太长时省略尾部——**哪一份**由左边那个名字回答
            （「项目配置」/「本机私有配置」），省略号砍掉的不是识别它的依据。
            完整路径挂在 title 上 */}
        <code className="hk__path" title={source.path}>
          {shortPath(source.path, home)}
        </code>
        <span className="hk__sum">{summaryOf(source)}</span>
        {source.exists ? (
          <button
            type="button"
            className="tbtn"
            onClick={() => {
              bridge?.openEnvFile(source.path)
            }}
          >
            打开
          </button>
        ) : null}
      </div>
      {source.error === undefined ? null : <p className="hk__alarm">{source.error}</p>}
      {source.hooks.map((hook, i) => (
        <HookRow key={`${hook.event}-${String(i)}`} hook={hook} />
      ))}
    </div>
  )
}

/** 右边那句话。三种「空」的原因不一样，**说同一句等于什么都没说**。 */
export function summaryOf(source: HookSource): string {
  if (!source.exists) return "还没有这份文件"
  if (source.hooks.length === 0) return "有这份文件，但没配钩子"
  const pending = source.hooks.filter((h) => h.trust === "pending").length
  const count = `${String(source.hooks.length)} 个钩子`
  return pending === 0 ? count : `${count} · ${String(pending)} 项待审核`
}

/**
 * 一条钩子。**命令原文一定要摆出来**——「有 3 个钩子」回答不了
 * 「它会干什么」，而那正是人来这一页要看的东西。
 */
function HookRow({ hook }: { hook: HookLine }): React.JSX.Element {
  const text = EVENT_TEXT[hook.event]
  return (
    <div className="hk__row">
      <div className="hk__meta">
        <span className="hk__event">{hook.event}</span>
        {text === undefined ? null : <span className="hk__when">{text}</span>}
        {hook.matcher === undefined ? null : <span className="hk__match">匹配 {hook.matcher}</span>}
        {hook.timeout === undefined ? null : <span className="hk__when">{hook.timeout} 秒上限</span>}
        {hook.trust === undefined ? null : (
          <span
            className={`hk__trust${hook.trust === "pending" ? " hk__trust--wait" : ""}`}
            title={
              hook.trust === "pending"
                ? "引擎的信任表里还没有这一条：它第一次跑到时会让你审一遍，在那之前不会执行"
                : "引擎的信任表里有这一条。改了命令的话它会重新问一次"
            }
          >
            {hook.trust === "pending" ? "待审核" : "已审核"}
          </span>
        )}
      </div>
      <code className="hk__cmd">{hook.command}</code>
      {hook.note === undefined ? null : <span className="hk__when">{hook.note}</span>}
    </div>
  )
}
