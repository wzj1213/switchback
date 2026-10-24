import { readFileSync } from "node:fs"
import { join } from "node:path"
import { acpAuthenticate, acpLogout, terminalLoginOf, tryAcp } from "@switchback/engine"
import type { AcpEngineRow, AcpLoginOutcome, AcpTrialView } from "../shared/acp-registry.js"
import { pruneAgents } from "./acp-install.js"
import { ENGINES_FILE, readEngineFile, type EngineEntry } from "./engines.js"
import { removeEngineEntry } from "./engines-file.js"
import type { Logger } from "./log.js"
import type { TerminalLogin } from "./terminal-login.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ACP_ENGINES } from "./acp-engines.messages.js"

/**
 * 已经写进 `engines.json` 的第三方 ACP 引擎：列出来、试接、登录、退出、移除。
 *
 * **每一件事都以文件里那一条为准**，渲染层只递名字过来——命令、参数、环境一概不从界面收。
 * 登录也一样：用哪种方式由人挑，但那一种的参数是现场重新握手问它要的，不信任何缓存。
 */
export interface EngineOpsDeps {
  userData: string
  log: Logger
  home: string
  inUse: (id: string) => boolean
  refresh: () => Promise<unknown>
  openTerminal: (login: TerminalLogin) => Promise<string | undefined>
  /** 说话用的语言，每次现读。缺省中文。 */
  locale?: () => Locale
}

/** 已接的这几家起一次握手最多等多久。npx 缓存过的是秒级；给一分钟是为了慢启动的 JVM 类。 */
const TRY_MS = 60_000

export function engineRows(deps: Pick<EngineOpsDeps, "userData" | "log" | "inUse">): readonly AcpEngineRow[] {
  return Object.entries(readEngineFile(deps.userData, deps.log)).map(([name, entry]) => ({
    name,
    id: `acp:${name}`,
    label: entry.label,
    command: entry.command,
    args: entry.args ?? [],
    ...(entry.registry === undefined ? {} : { source: entry.registry }),
    inUse: deps.inUse(`acp:${name}`),
  }))
}

function entryOf(deps: EngineOpsDeps, name: string): EngineEntry | undefined {
  return readEngineFile(deps.userData, deps.log)[name]
}

const localeOf = (deps: Pick<EngineOpsDeps, "locale">): Locale => deps.locale?.() ?? DEFAULT_LOCALE

function gone(deps: EngineOpsDeps): { ok: false; error: string } {
  return { ok: false, error: ACP_ENGINES[localeOf(deps)].gone(ENGINES_FILE) }
}

/** 起它要的全部：命令、参数、环境以 engines.json 那一条为准；语言是这一刻的界面语言。 */
function launchOf(entry: EngineEntry, deps: EngineOpsDeps): {
  command: string
  args: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd: string
  locale: Locale
} {
  const env = entry.env === undefined ? {} : { env: entry.env }
  return { command: entry.command, args: entry.args ?? [], ...env, cwd: deps.home, locale: localeOf(deps) }
}

export async function tryEngine(name: string, deps: EngineOpsDeps): Promise<AcpTrialView> {
  const entry = entryOf(deps, name)
  if (entry === undefined) return gone(deps)
  return tryAcp({ ...launchOf(entry, deps), timeoutMs: TRY_MS })
}

/** terminal 型：现场握手问它要这一种的参数，再在「终端」里跑它自己的登录界面。 */
async function terminalLogin(entry: EngineEntry, methodId: string, deps: EngineOpsDeps): Promise<AcpLoginOutcome> {
  const m = ACP_ENGINES[localeOf(deps)]
  const trial = await tryAcp({ ...launchOf(entry, deps), timeoutMs: TRY_MS })
  if (!trial.ok) return { ok: false, error: trial.error ?? m.trialFailed, ...(trial.stderr === undefined ? {} : { stderr: trial.stderr }) }
  const method = trial.authMethods?.find((one) => one.id === methodId && one.kind === "terminal")
  if (method === undefined) return { ok: false, error: m.noMethod }
  const line = terminalLoginOf(entry, method)
  const error = await deps.openTerminal({ label: entry.label, ...line, cwd: deps.home, path: process.env["PATH"] ?? "" })
  return error === undefined ? { ok: true, terminal: true } : { ok: false, error }
}

export async function loginEngine(
  req: { name: string; methodId: string; kind: "agent" | "terminal" },
  deps: EngineOpsDeps,
  signal?: AbortSignal,
): Promise<AcpLoginOutcome> {
  const entry = entryOf(deps, req.name)
  if (entry === undefined) return gone(deps)
  if (req.kind === "terminal") return terminalLogin(entry, req.methodId, deps)
  return acpAuthenticate({ ...launchOf(entry, deps), methodId: req.methodId, ...(signal === undefined ? {} : { signal }) })
}

export async function logoutEngine(name: string, deps: EngineOpsDeps): Promise<AcpLoginOutcome> {
  const entry = entryOf(deps, name)
  return entry === undefined ? gone(deps) : acpLogout(launchOf(entry, deps))
}

/**
 * 移除。**有会话在用也照删文件**——人已经决定不要它了；只是那几条会话还握着旧驱动，
 * 要等它们关掉才真正摘下，下载过的二进制也等那时（或下次启动）再清。
 */
export async function removeEngine(name: string, deps: EngineOpsDeps): Promise<{ ok: boolean; error?: string; pending?: boolean }> {
  const using = deps.inUse(`acp:${name}`)
  const done = removeEngineEntry(deps.userData, name, localeOf(deps))
  if (!done.ok) return { ok: false, ...(done.error === undefined ? {} : { error: done.error }) }
  await deps.refresh()
  if (!using) await pruneUnused(deps.userData)
  return { ok: true, ...(using ? { pending: true } : {}) }
}

/**
 * 清掉没有条目再用的二进制。**文件读不出来就一个都不删**：`readEngineFile` 遇到坏 JSON
 * 返回空表，拿空表去清等于把装过的全删了——人只是手改时少打了一个逗号。
 */
export async function pruneUnused(userData: string): Promise<readonly string[]> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(userData, ENGINES_FILE), "utf8"))
  } catch {
    return []
  }
  if (typeof raw !== "object" || raw === null) return []
  const commands = Object.values(raw as Record<string, unknown>).flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { command?: unknown }).command === "string"
      ? [(entry as { command: string }).command]
      : [],
  )
  return pruneAgents(join(userData, "agents"), commands)
}
