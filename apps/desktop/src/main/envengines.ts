import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"
import { hookLines, hookLinesFlat, trustKeyOf, type HookScope, type HookSource } from "../shared/hooks.js"
import type { Logger } from "./log.js"

/**
 * 只能**读文件**的那三家：codex / Kimi Code / Grok。
 *
 * Claude 那家不在这里——它有 `resolveSettings`，问它自己比读文件准（见 `envconfig.ts`）。
 * 这三家都没有等价的 API：codex 只有 `codex doctor`（起进程、跑好几秒），
 * 另两家连那个都没有。而这一页要求**打开就有**，所以只能自己读。
 *
 * ## 各家读哪几份、什么形状
 *
 * | 引擎 | 位置 | 形状 |
 * | --- | --- | --- |
 * | codex | `~/.codex/{config.toml,hooks.json}`、`<项目>/.codex/{config.toml,hooks.json}` | toml 是 `[[hooks.事件]]` 套 `[[hooks.事件.hooks]]`；json 同 Claude |
 * | Kimi Code | `~/.kimi-code/config.toml` | **平表** `[[hooks]]`，事件写在条目上 |
 * | Grok | `~/.grok/{managed_config,config}.toml`、`<项目>/.grok/config.toml`、`<项目>/.grok/hooks/*.json` | 同 codex；JSON 那几份同 Claude |
 *
 * 三家的家目录都认各自的环境变量（`CODEX_HOME` / `KIMI_CODE_HOME` / `GROK_HOME`），
 * **跟着它们走，不写死 `~/.x`**——改过家目录的人正是最需要这一页的人。
 */

/** 一次读盘的结果。`error` 有值 = 文件在、但读不懂，那时钩子清单是**不完整的**。 */
export interface Read {
  exists: boolean
  value?: unknown
  error?: string
}

/** 家目录：环境变量优先。 */
function homeOf(env: string, fallback: string): string {
  const set = process.env[env]
  return set === undefined || set === "" ? join(homedir(), fallback) : set
}

/* ── codex ───────────────────────────────────────────────────── */

/**
 * codex 的钩子**有两个窝**，缺一不可：
 *
 * - `config.toml` 里的 `[[hooks.事件]]`（项目里那份常用这个）
 * - **`hooks.json` 一份独立的文件**（家目录那份常用这个，形状和 Claude 一样）
 *
 * 只读前者的下场实测过：codex 自己的界面显示「用户配置 6 个钩子」，
 * omni 这边一个都没有——那 6 条全写在 `~/.codex/hooks.json` 里。
 * 「配了没生效」本来就是这一页要回答的问题，而它自己漏看了一半。
 */
export async function codexSources(cwd: string | undefined, log: Logger): Promise<readonly HookSource[]> {
  const home = homeOf("CODEX_HOME", ".codex")
  const userToml = join(home, "config.toml")
  const user = await readToml(userToml, log)
  // 审过的那些记在**用户的 config.toml** 里（`[hooks.state]`），
  // 另外三份的信任状态也都要问它
  const trusted = trustedKeys(user.value)
  const out = [
    codexSource("user", userToml, user, trusted),
    codexSource("user", join(home, "hooks.json"), await readJson(join(home, "hooks.json")), trusted),
  ]
  if (cwd !== undefined) {
    const toml = join(cwd, ".codex", "config.toml")
    const json = join(cwd, ".codex", "hooks.json")
    out.push(codexSource("project", toml, await readToml(toml, log), trusted))
    out.push(codexSource("project", json, await readJson(json), trusted))
  }
  return out
}

function codexSource(scope: HookScope, path: string, read: Read, trusted: ReadonlySet<string>): HookSource {
  return {
    engine: "codex",
    scope,
    path,
    exists: read.exists,
    // `hooks.json` 整份就是 `{ "hooks": {...} }`，config.toml 是 `[hooks]` 那一节，
    // 两者取出来是同一个形状；再兜一层「整份就是那张表」的写法
    hooks: hookLines(hooksOf(read.value) ?? read.value, (event, group, index) =>
      trusted.has(trustKeyOf(path, event, group, index)) ? "trusted" : "pending",
    ),
    ...(read.error === undefined ? {} : { error: read.error }),
  }
}

/** `[hooks.state]` 里的键就是「审过的那些」。读不出来就当一条都没审过——**宁可说待审核**。 */
function trustedKeys(doc: unknown): ReadonlySet<string> {
  const state = (doc as { hooks?: { state?: unknown } } | undefined)?.hooks?.state
  return new Set(typeof state === "object" && state !== null ? Object.keys(state) : [])
}

/* ── Kimi Code ───────────────────────────────────────────────── */

/**
 * Kimi 只有**用户那一份**配置（`resolveConfigPath` 只认家目录那个 config.toml，
 * 项目里没有第二层）。所以这里只回一条，界面上也照实说。
 */
export async function kimiSources(log: Logger): Promise<readonly HookSource[]> {
  const path = join(homeOf("KIMI_CODE_HOME", ".kimi-code"), "config.toml")
  const read = await readToml(path, log)
  return [
    {
      engine: "kimi",
      scope: "user",
      path,
      exists: read.exists,
      hooks: hookLinesFlat(hooksOf(read.value)),
      ...(read.error === undefined ? {} : { error: read.error }),
    },
  ]
}

/* ── Grok ────────────────────────────────────────────────────── */

export async function grokSources(cwd: string | undefined, log: Logger): Promise<readonly HookSource[]> {
  const home = homeOf("GROK_HOME", ".grok")
  const layers: (readonly [HookScope, string])[] = [
    ["managed", join(home, "managed_config.toml")],
    ["user", join(home, "config.toml")],
    ...(cwd === undefined ? [] : [["project", join(cwd, ".grok", "config.toml")] as const]),
  ]
  const out: HookSource[] = []
  for (const [scope, path] of layers) {
    const read = await readToml(path, log)
    out.push({
      engine: "grok",
      scope,
      path,
      exists: read.exists,
      hooks: hookLines(hooksOf(read.value)),
      ...(read.error === undefined ? {} : { error: read.error }),
    })
  }
  if (cwd !== undefined) out.push(...(await grokHookFiles(join(cwd, ".grok", "hooks"))))
  return out
}

/**
 * Grok 还认**项目里的钩子文件**：`<项目>/.grok/hooks/*.json`，一份一个来源。
 *
 * 目录不在（或者一个 json 都没有）时回一条空的占位——「这儿可以放」本身是信息，
 * 而这是 grok 官方文档里给的那个位置。
 */
async function grokHookFiles(dir: string): Promise<readonly HookSource[]> {
  const names = await readdir(dir).catch(() => undefined)
  const files = (names ?? []).filter((n) => n.endsWith(".json")).sort()
  if (files.length === 0) return [{ engine: "grok", scope: "project", path: dir, exists: false, hooks: [] }]
  const out: HookSource[] = []
  for (const name of files) {
    const path = join(dir, name)
    const read = await readJson(path)
    out.push({
      engine: "grok",
      scope: "project",
      path,
      exists: read.exists,
      // 钩子文件既可能整份就是那张表，也可能包一层 `hooks`——两种都收
      hooks: hookLines(hooksOf(read.value) ?? read.value),
      ...(read.error === undefined ? {} : { error: read.error }),
    })
  }
  return out
}

/* ── 读盘 ────────────────────────────────────────────────────── */

/** 取出 `hooks` 那一节。整份不是对象时是 undefined。 */
function hooksOf(doc: unknown): unknown {
  return typeof doc === "object" && doc !== null ? (doc as { hooks?: unknown }).hooks : undefined
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch {
    // 没有这个文件是常态，不值得记一条日志
    return undefined
  }
}

export async function readJson(path: string): Promise<Read> {
  const raw = await readText(path)
  if (raw === undefined) return { exists: false }
  try {
    return { exists: true, value: JSON.parse(raw) as unknown }
  } catch (error) {
    return { exists: true, error: `这份 JSON 解析不了：${String(error)}` }
  }
}

export async function readToml(path: string, log: Logger): Promise<Read> {
  const raw = await readText(path)
  if (raw === undefined) return { exists: false }
  try {
    return { exists: true, value: parseToml(raw) }
  } catch (error) {
    log.write("warn", "env", `${path} 解析不了：${String(error)}`)
    return { exists: true, error: `这份 TOML 解析不了：${String(error)}` }
  }
}
