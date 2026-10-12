import { homedir } from "node:os"
import { join } from "node:path"
import { ipcMain, shell } from "electron"
import { resolveSettings } from "@anthropic-ai/claude-agent-sdk"
import { hookLines, type EnvConfig, type HookEngine, type HookScope, type HookSource } from "../shared/hooks.js"
import { codexSources, grokSources, kimiSources, readJson } from "./envengines.js"
import type { Logger } from "./log.js"
import type { Channels } from "./channels.js"

/**
 * 「环境」那一页的数据：**各家引擎自己读的那几份配置里，钩子有哪些。**
 *
 * ## 为什么不能靠猜
 *
 * 「我配的钩子生效了没有」这个问题，之前在 Switchback 里**没有任何入口能回答**。
 * 而它有好几个各自独立的失败方式，每一个都不报错：
 *
 * 1. 写错了地方（家目录那份 vs 项目那份 vs `settings.local.json`）
 * 2. Claude 的 `disableAllHooks` 把全部关掉了
 * 3. codex 与 grok 的钩子**要先审过才跑**，而没审的那条就静静地不跑
 *
 * ## Claude 那份问 SDK，不自己合并
 *
 * `resolveSettings` 用的是**和 CLI 同一套合并引擎**（还包含管理员 MDM 那一层，
 * 那一层我们自己读不出来）。自己抄一份合并规则的下场是它和引擎慢慢分岔，
 * 而界面上说的「生效的是这几条」会变成谎话。它标着 @alpha，所以有兜底：
 * 问不到就直接读那三份文件——比整页空着强。
 *
 * 其余三家没有等价的 API，只能读文件，那部分在 `envengines.ts`。
 *
 * ## 四家都做，但不做第三方 ACP 引擎
 *
 * `engines.json` 里挂的那些是**用户自己注册的**，Switchback 只知道怎么把它们拉起来，
 * 不知道它们的配置文件在哪、长什么样。编一个路径出来查，比不查更糟——
 * 界面上会显示「没有钩子」，而那可能是查错了地方。界面上照实说这一句。
 */

/** 一份 Claude 设置文件里我们要的那几项。**逐字段读，不整份信任**——用户手写的。 */
interface ClaudeSettings {
  hooks?: unknown
  disableAllHooks?: unknown
  allowManagedHooksOnly?: unknown
}

/** 摆在界面上的顺序：管理员 → 用户 → 项目 → 本机。和优先级从低到高相反，但**和人找它的顺序一致**。 */
const ORDER: readonly HookScope[] = ["managed", "user", "project", "local"]

/** 引擎之间的顺序。和引擎选择器里那一排一致，不另发明一套。 */
const ENGINES: readonly HookEngine[] = ["claude", "codex", "kimi", "grok"]

export function installEnvChannel(log: Logger, channels: Channels): void {
  // 允许打开的路径**只能是这一页刚发出去的那些**。渲染层拿不到一个能打开任意文件的口子
  const shown = new Set<string>()
  channels.handle("switchback:envConfig", async (value: unknown): Promise<EnvConfig> => {
    const cwd = typeof value === "string" ? value : undefined
    const claude = await claudeSide(cwd, log)
    const rest = [
      ...(await codexSources(cwd, log)),
      ...(await kimiSources(log)),
      ...(await grokSources(cwd, log)),
    ]
    const sources = dedupe([...claude.sources, ...rest].sort(order))
    shown.clear()
    for (const s of sources) shown.add(s.path)
    return {
      ...(cwd === undefined ? {} : { cwd }),
      home: homedir(),
      sources,
      disabledAll: claude.disabledAll,
      managedOnly: claude.managedOnly,
    }
  })
  ipcMain.on("switchback:openEnvFile", (_e, path: string) => {
    // 用系统默认编辑器打开，不自己做一个配置界面——理由和 `engines.json` 那条一样
    if (shown.has(path)) void shell.openPath(path)
  })
}

/**
 * 同一份文件只留一条。
 *
 * **在家目录里开会话时，「项目配置」和「用户配置」指的是同一个文件**
 *（`~/.codex/config.toml` 既是家目录那份、又是 `<cwd>/.codex/config.toml`）。
 * 不去重的话那一份会被列两遍、钩子也数两遍——实测在 `/Users/you` 里开的会话上
 * Claude 那一栏因此翻了一倍。排序在前的（层级更靠上的）留下。
 */
function dedupe(sources: readonly HookSource[]): readonly HookSource[] {
  const seen = new Set<string>()
  return sources.filter((s) => {
    const key = `${s.engine}\u0000${s.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 先按引擎，再按配置层。同层多份（grok 的钩子文件）保持读出来的先后。 */
function order(a: HookSource, b: HookSource): number {
  const byEngine = ENGINES.indexOf(a.engine) - ENGINES.indexOf(b.engine)
  return byEngine === 0 ? ORDER.indexOf(a.scope) - ORDER.indexOf(b.scope) : byEngine
}

/* ── Claude ──────────────────────────────────────────────────── */

interface ClaudeSide {
  sources: readonly HookSource[]
  disabledAll: boolean
  managedOnly: boolean
}

async function claudeSide(cwd: string | undefined, log: Logger): Promise<ClaudeSide> {
  try {
    const resolved = await resolveSettings(cwd === undefined ? {} : { cwd })
    const found: HookSource[] = []
    for (const entry of resolved.sources) {
      const scope = scopeOf(entry.source)
      // `flag` 那一层是 `--settings` 传进来的，Switchback 从不传——真出现了也没有文件路径可给
      if (scope === undefined || entry.path === undefined) continue
      found.push(claudeSource(scope, entry.path, entry.settings as ClaudeSettings))
    }
    const effective = resolved.effective as ClaudeSettings
    return {
      sources: withPlaceholders(found, cwd),
      disabledAll: effective.disableAllHooks === true,
      managedOnly: effective.allowManagedHooksOnly === true,
    }
  } catch (error) {
    log.write("warn", "env", `问不到 Claude 的设置：${String(error)}`)
    return { sources: await claudeFallback(cwd), disabledAll: false, managedOnly: false }
  }
}

function claudeSource(scope: HookScope, path: string, settings: ClaudeSettings): HookSource {
  return { engine: "claude", scope, path, exists: true, hooks: hookLines(settings.hooks) }
}

function scopeOf(source: string): HookScope | undefined {
  return ORDER.find((s) => s === source)
}

/**
 * 把「这儿可以配、但现在没有这份文件」也摆出来。
 *
 * `resolveSettings` 只回真实存在的那几份，而**「项目里还没有 .claude/settings.json」
 * 正是用户最需要知道的一句话**——他多半以为自己写的那条在这儿。
 */
function withPlaceholders(found: readonly HookSource[], cwd: string | undefined): readonly HookSource[] {
  const out = [...found]
  for (const [scope, path] of claudePaths(cwd)) {
    if (out.some((s) => s.path === path)) continue
    out.push({ engine: "claude", scope, path, exists: false, hooks: [] })
  }
  return out
}

/** Claude 认的那三份（管理员那一层是 MDM 管的，没有固定的「该建在哪」，不摆占位）。 */
function claudePaths(cwd: string | undefined): readonly (readonly [HookScope, string])[] {
  const user = [["user", join(homedir(), ".claude", "settings.json")] as const]
  if (cwd === undefined) return user
  return [
    ...user,
    ["project", join(cwd, ".claude", "settings.json")] as const,
    ["local", join(cwd, ".claude", "settings.local.json")] as const,
  ]
}

/** SDK 那条路不通时自己读。**只读不合并**：合并规则属于引擎，抄一份迟早分岔。 */
async function claudeFallback(cwd: string | undefined): Promise<readonly HookSource[]> {
  const out: HookSource[] = []
  for (const [scope, path] of claudePaths(cwd)) {
    const read = await readJson(path)
    out.push({
      engine: "claude",
      scope,
      path,
      exists: read.exists,
      hooks: hookLines((read.value as ClaudeSettings | undefined)?.hooks),
      ...(read.error === undefined ? {} : { error: read.error }),
    })
  }
  return out
}
