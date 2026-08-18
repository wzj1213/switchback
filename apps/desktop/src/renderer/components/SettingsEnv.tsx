import { useState } from "react"
import type { HookEngine, HookSource } from "../../shared/hooks.js"
import { useEnvConfig } from "../useEnvConfig.js"
import { SourceCard } from "./HookList.js"
import { ChevronIcon } from "./icons.js"

/**
 * 环境：**你配的那些钩子，到底在不在、会不会跑。**
 *
 * ## 这一页要回答的问题
 *
 * 钩子写在引擎自己的配置里，而「配了没生效」有好几个各自独立的原因，
 * 每一个都不报错（见 `shared/hooks.ts` 开头）。之前 omni 里没有任何入口
 * 能回答它——你只能等某次生效、或者某次没生效才发现。
 *
 * ## 四家都列，没有的那几家折起来
 *
 * 四家里有三家默认是空的（多数人只在一两家上配过钩子）。**空的也要有一行**——
 * 「Grok 这儿也能配，只是你没配」和「omni 不看 Grok」是两回事，
 * 而后者正是这一页最该避免的误解。所以：有钩子的展开，没有的折成一行。
 *
 * ## 只读，不给开关
 *
 * codex 那边的同一块界面每条钩子右边有个开关。omni 不做：那意味着替用户改
 * 他手写的配置（改哪一份？项目那份是要提交进仓库的）。这里负责让他**看得见**，
 * 改还是回他自己的编辑器——「打开」就在每一行右边。
 */

/** 每家引擎下面那句话：**omni 到底加不加载这些**。这是整页最要紧的一句。 */
const ENGINE_TEXT: Readonly<Record<HookEngine, { label: string; note: string }>> = {
  claude: {
    label: "Claude Code",
    note: "omni 起 Claude 走官方 SDK，设置照常按 用户 → 项目 → 本机 加载，和你在终端里跑 claude 一样。",
  },
  codex: {
    label: "Codex",
    note: "omni 起的是 codex app-server，读的就是这两份。注意 codex 的钩子要先审过才跑——待审核的那条不会跑。",
  },
  kimi: {
    label: "Kimi Code",
    note: "omni 起的是 kimi acp，读家目录那份 config.toml。它的钩子是一张平表（[[hooks]]，事件写在条目上），而且只有用户这一层——项目里没有第二份。",
  },
  grok: {
    label: "Grok",
    note: "omni 起的是 grok agent stdio。除了配置里的 [[hooks.事件]]，它还认项目里的 .grok/hooks/*.json。项目里的钩子要先 /hooks-trust 过才跑，而那份信任记在哪 omni 读不到——所以这家不标「已审核 / 待审核」。",
  },
}

export function EnvSection({ cwd }: { cwd: string | undefined }): React.JSX.Element {
  const env = useEnvConfig(cwd)
  const sources = env.data?.sources ?? []
  return (
    <div className="hk">
      <div className="hk__lead">
        <p className="set__note">
          下面是各家引擎<strong>自己</strong>读的那几份配置里的钩子。omni 只读不改，改还是回你的编辑器。
        </p>
        <button type="button" className="tbtn" onClick={env.reload} disabled={env.loading}>
          {env.loading ? "读取中…" : "重新读一遍"}
        </button>
      </div>
      {cwd === undefined ? null : (
        <p className="hk__cwd">
          按这个工作区算：<bdi>{cwd}</bdi>
        </p>
      )}
      {env.data?.disabledAll === true ? (
        <p className="hk__alarm">
          Claude 的设置里开着 <code>disableAllHooks</code>——下面 Claude 那几条<strong>一条都不会跑</strong>。
        </p>
      ) : null}
      {env.data?.managedOnly === true ? (
        <p className="hk__alarm">
          管理员配置里开着 <code>allowManagedHooksOnly</code>：只有管理员那份里的钩子会跑。
        </p>
      ) : null}
      {env.data === undefined ? (
        <p className="set__hint">正在读各家的配置…</p>
      ) : (
        (Object.keys(ENGINE_TEXT) as HookEngine[]).map((engine) => (
          <EngineBlock
            key={engine}
            engine={engine}
            home={env.data?.home ?? ""}
            sources={sources.filter((s) => s.engine === engine)}
          />
        ))
      )}
      <p className="hk__foot">
        这里不含：插件带来的钩子（那些由引擎在运行时加载，配置文件里看不到）、以及 engines.json
        里挂的第三方 ACP 引擎——omni 只知道怎么把它们拉起来，不知道它们的配置在哪，编一个路径去查比不查更糟。
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
        <ChevronIcon open={open} size={12} />
        {ENGINE_TEXT[engine].label}
        <span className="hk__total">{total === 0 ? "没有钩子" : `${String(total)} 个钩子`}</span>
        {/* 待审核的数目要在**折起来的时候也看得见**：它就是「配了但不跑」那个答案 */}
        {pending === 0 ? null : <span className="hk__trust hk__trust--wait">{pending} 项待审核</span>}
      </button>
      {open ? (
        <>
          <p className="hk__why">{ENGINE_TEXT[engine].note}</p>
          {sources.map((source) => (
            <SourceCard key={source.path} source={source} home={home} />
          ))}
        </>
      ) : null}
    </section>
  )
}
