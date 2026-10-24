import type { AcpTrial } from "@switchback/engine"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import type { ConnectProgress, ConnectResult, LaunchPlan } from "../shared/acp-registry.js"
import { planOf, type RegistryAgent, type RegistryPlatform } from "./acp-registry-model.js"
import type { InstallResult } from "./acp-install.js"
import type { RegistrySnapshot } from "./acp-registry.js"
import { readEngineFile, type EngineFile, type RegistrySource } from "./engines.js"
import { addEngineEntry, engineNameOf, replaceEngineEntry, type EntryInput } from "./engines-file.js"
import type { Logger } from "./log.js"
import { ACP_CONNECT } from "./acp-connect.messages.js"

type Text = (typeof ACP_CONNECT)[Locale]

/**
 * 从注册表接一家：**装（只有二进制要装）→ 试接 → 写进 engines.json → 当场接上**。
 *
 * 和「指个文件」那条路同一个规矩：**先试再写**。握手答不上来就不写——写进去的只会是
 * 一条起不来的会话。试接回来的登录方式原样交给界面，人挑了才去登录。
 *
 * 已经接过这一家（engines.json 里有同一个注册表 id）就是「升级」：换掉那一条，
 * 不另起一条——同一家在引擎下拉里出现两次，会让人分不清哪条是新的。
 */
export interface ConnectDeps {
  userData: string
  log: Logger
  home: string
  platform: RegistryPlatform | undefined
  registry: () => Promise<RegistrySnapshot>
  launchers: () => Promise<{ npx: boolean; uvx: boolean }>
  install: (agent: RegistryAgent, plan: Extract<LaunchPlan, { kind: "binary" }>) => Promise<InstallResult>
  trial: (req: { command: string; args: readonly string[]; env?: Readonly<Record<string, string>>; cwd: string; timeoutMs: number }) => Promise<AcpTrial>
  refresh: () => Promise<unknown>
  inUse: (id: string) => boolean
  progress: (step: ConnectProgress) => void
  /** 说话用的语言。缺省中文。 */
  locale?: Locale
}

/** npx / uvx 第一次要现下载，给足；二进制已经在盘上，一分钟起不来就是起不来。 */
const FIRST_RUN_MS = 180_000
const BINARY_MS = 60_000

interface Launch {
  command: string
  args: readonly string[]
  env?: Readonly<Record<string, string>>
}

async function launchOf(agent: RegistryAgent, plan: LaunchPlan, deps: ConnectDeps): Promise<Launch | { error: string }> {
  if (plan.kind !== "binary") return { command: plan.command, args: plan.args, ...(plan.env === undefined ? {} : { env: plan.env }) }
  const installed = await deps.install(agent, plan)
  if (!installed.ok) return { error: installed.error }
  return { command: installed.command, args: plan.args, ...(plan.env === undefined ? {} : { env: plan.env }) }
}

/** 试接没过时补一句下一步。npx 第一次下载超时是最常见的一种，值得单说。 */
function trialError(plan: LaunchPlan, trial: AcpTrial, m: Text): string {
  const said = trial.error ?? m.trialFailed
  if (plan.kind === "binary" || trial.timedOut !== true) return said
  return m.firstRun(said, plan.kind, plan.package, `${plan.command} ${plan.args.join(" ")}`)
}

/** 这一家在 engines.json 里叫什么：接过就沿用那个键，没接过就用注册表 id（撞名就加序号）。 */
function nameFor(agent: RegistryAgent, file: EngineFile): { name: string; replace: boolean } {
  const existing = Object.entries(file).find(([, entry]) => entry.registry?.id === agent.id)
  if (existing !== undefined) return { name: existing[0], replace: true }
  const base = engineNameOf(agent.id) ?? "agent"
  const free = [base, ...[2, 3, 4, 5].map((n) => `${base}-${String(n)}`)].find((name) => !Object.hasOwn(file, name))
  return { name: free ?? `${base}-${agent.version}`, replace: false }
}

function entryFor(agent: RegistryAgent, plan: LaunchPlan, launch: Launch): EntryInput {
  const registry: RegistrySource = { id: agent.id, version: agent.version, kind: plan.kind }
  return { label: agent.name, command: launch.command, args: launch.args, ...(launch.env === undefined ? {} : { env: launch.env }), registry }
}

/** 试接通过之后：写进 engines.json（接过就换那一条）、当场接上。 */
async function commit(agent: RegistryAgent, input: EntryInput, trial: AcpTrial, deps: ConnectDeps): Promise<ConnectResult> {
  deps.progress({ agentId: agent.id, phase: "write" })
  const { name, replace } = nameFor(agent, readEngineFile(deps.userData, deps.log))
  const locale = deps.locale ?? DEFAULT_LOCALE
  const written = replace ? replaceEngineEntry(deps.userData, name, input, locale) : addEngineEntry(deps.userData, name, input, locale)
  if (!written.ok) return { ok: false, error: written.error ?? ACP_CONNECT[locale].cantWrite, trial }
  await deps.refresh()
  const id = `acp:${name}`
  return { ok: true, name, id, trial, ...(replace && deps.inUse(id) ? { pending: true } : {}) }
}

export async function connectAgent(agentId: string, deps: ConnectDeps): Promise<ConnectResult> {
  const m = ACP_CONNECT[deps.locale ?? DEFAULT_LOCALE]
  const agent = (await deps.registry()).agents.find((one) => one.id === agentId)
  if (agent === undefined) return { ok: false, error: m.gone }
  const { plan, missing } = planOf(agent, deps.platform, await deps.launchers(), deps.locale)
  if (plan === undefined) return { ok: false, error: m.cantRun(missing ?? m.noRun) }
  if (plan.kind === "binary") deps.progress({ agentId, phase: "download" })
  const launch = await launchOf(agent, plan, deps)
  if ("error" in launch) return { ok: false, error: launch.error }
  deps.progress({ agentId, phase: "trial" })
  const trial = await deps.trial({ ...launch, cwd: deps.home, timeoutMs: plan.kind === "binary" ? BINARY_MS : FIRST_RUN_MS })
  if (!trial.ok) return { ok: false, error: trialError(plan, trial, m), ...(trial.stderr === undefined ? {} : { stderr: trial.stderr }), trial }
  return commit(agent, entryFor(agent, plan, launch), trial, deps)
}
