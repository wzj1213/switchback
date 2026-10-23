import { useState } from "react"
import type { HookEngine, HookSource } from "../../shared/hooks.js"
import { useEnvConfig } from "../useEnvConfig.js"
import { SourceCard } from "./HookList.js"
import { ChevronIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { SETTINGS_ENV } from "./SettingsEnv.messages.js"

/**
 * 环境：**你配的那些钩子，到底在不在、会不会跑。**
 *
 * ## 这一页要回答的问题
 *
 * 钩子写在引擎自己的配置里，而「配了没生效」有好几个各自独立的原因，
 * 每一个都不报错（见 `shared/hooks.ts` 开头）。之前 Switchback 里没有任何入口
 * 能回答它——你只能等某次生效、或者某次没生效才发现。
 *
 * ## 四家都列，没有的那几家折起来
 *
 * 四家里有三家默认是空的（多数人只在一两家上配过钩子）。**空的也要有一行**——
 * 「Grok 这儿也能配，只是你没配」和「Switchback 不看 Grok」是两回事，
 * 而后者正是这一页最该避免的误解。所以：有钩子的展开，没有的折成一行。
 *
 * ## 只读，不给开关
 *
 * codex 那边的同一块界面每条钩子右边有个开关。Switchback 不做：那意味着替用户改
 * 他手写的配置（改哪一份？项目那份是要提交进仓库的）。这里负责让他**看得见**，
 * 改还是回他自己的编辑器——「打开」就在每一行右边。
 */

/**
 * 每家引擎的名字。名字下面那句话——**Switchback 到底加不加载这些**，整页最要紧的一句——
 * 在 `SettingsEnv.messages.ts` 的 `note`。
 */
const ENGINE_LABEL: Readonly<Record<HookEngine, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  kimi: "Kimi Code",
  grok: "Grok",
}

export function EnvSection({ cwd }: { cwd: string | undefined }): React.JSX.Element {
  const env = useEnvConfig(cwd)
  const m = useMessages(SETTINGS_ENV)
  const sources = env.data?.sources ?? []
  return (
    <div className="hk">
      <div className="hk__lead">
        <p className="set__note">
          {m.leadBefore}<strong>{m.leadStrong}</strong>{m.leadAfter}
        </p>
        <button type="button" className="tbtn" onClick={env.reload} disabled={env.loading}>
          {env.loading ? m.reading : m.reread}
        </button>
      </div>
      {cwd === undefined ? null : (
        <p className="hk__cwd">
          {m.cwd}<bdi>{cwd}</bdi>
        </p>
      )}
      {env.failed ? (
        <p className="hk__alarm" role="alert">{m.failed}</p>
      ) : null}
      {env.data?.disabledAll === true ? (
        <p className="hk__alarm">
          {m.disabledBefore}<code>disableAllHooks</code>{m.disabledMid}<strong>{m.disabledStrong}</strong>{m.disabledAfter}
        </p>
      ) : null}
      {env.data?.managedOnly === true ? (
        <p className="hk__alarm">
          {m.managedBefore}<code>allowManagedHooksOnly</code>{m.managedAfter}
        </p>
      ) : null}
      {/* 四家收在一张卡里、一家一行：和设置其余各页同一种「这几行是一组」的画法 */}
      <div className="hk__list">
        {env.data === undefined ? (
          <p className="set__blank">{m.loading}</p>
        ) : (
          (Object.keys(ENGINE_LABEL) as HookEngine[]).map((engine) => (
            <EngineBlock
              key={engine}
              engine={engine}
              home={env.data?.home ?? ""}
              sources={sources.filter((s) => s.engine === engine)}
            />
          ))
        )}
      </div>
      {/* **没读到的要说出来。** 一页写着「没有钩子」的界面，和一页写着
          「这几处我没查」的界面，给人的判断完全不同——前者会让他停止排查 */}
      <p className="hk__foot">
        {m.foot1}<strong>{m.footStrong1}</strong>{m.foot2}<strong>{m.footStrong2}</strong>{m.foot3}
      </p>
    </div>
  )
}

/**
 * 一家引擎。**标题整条是开关**：没有钩子的那几家折起来，
 * 展开之后才是「它读哪几份文件」。
 */
function EngineBlock({
  engine,
  sources,
  home,
}: {
  engine: HookEngine
  sources: readonly HookSource[]
  home: string
}): React.JSX.Element {
  const m = useMessages(SETTINGS_ENV)
  const total = sources.reduce((n, s) => n + s.hooks.length, 0)
  const [open, setOpen] = useState(total > 0)
  const pending = sources.reduce((n, s) => n + s.hooks.filter((h) => h.trust === "pending").length, 0)
  return (
    <section className="hk__engine">
      <button
        type="button"
        className="hk__name"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <ChevronIcon open={open} size={14} />
        {ENGINE_LABEL[engine]}
        <span className="hk__total">{total === 0 ? m.noHooks : m.hooks(total)}</span>
        {/* 待审核的数目要在**折起来的时候也看得见**：它就是「配了但不跑」那个答案 */}
        {pending === 0 ? null : <span className="hk__trust hk__trust--wait">{m.pending(pending)}</span>}
      </button>
      {open ? (
        <div className="hk__body">
          <p className="hk__why">{m.note[engine]}</p>
          {sources.map((source) => (
            <SourceCard key={source.path} source={source} home={home} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
