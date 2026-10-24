import type { ChildProcess } from "node:child_process"
import type { EngineDriver } from "../contract.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { localeOf } from "../locale.js"
import { probeCommand, type Probe } from "../probe.js"
import { createRpc, type RpcPeer } from "../rpc.js"
import { createProcessOwner } from "../subprocess.js"
import { createAcpDriver } from "./driver.js"
import type { AcpInitialize } from "./wire.js"
import { ACP_DSH } from "./dsh.messages.js"

type Text = (typeof ACP_DSH)[Locale]

/** DSH 把 ACP 做成 profile；Switchback 只启动这扇公开的 stdio 门。 */
const DEFAULT_PROFILE = "acp"
const CHECK_MS = 10_000
const RECLAIM_MS = 500
const STDERR_KEEP = 1200
const INITIALIZE = {
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  },
  clientInfo: { name: "switchback", title: "Switchback", version: "0.1.0" },
}

export type DshCommandProbe = (command: string, hint?: string, locale?: Locale) => Promise<Probe>
export interface DshProfileStatus {
  ready: boolean
  detail?: string
  /** initialize 中 agent 自报的身份。 */
  agent?: string
  /** initialize 中能确认的能力；没有能力位时明确写“会话仅新建”。 */
  capabilities?: readonly string[]
}
export type DshProfileCheck = (command: string, profile: string, locale?: Locale) => Promise<DshProfileStatus>

export interface DshDriverOptions {
  command?: string
  /** 新会话采用的 DSH profile；续跑/分叉始终优先使用请求里保存的 profile。 */
  profile?: () => string
  commandProbe?: DshCommandProbe
  profileCheck?: DshProfileCheck
}

export function isDshProfileName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && name !== "node_modules"
    && !name.includes("/") && !name.includes("\\")
}

function argsOf(profile: string): readonly string[] {
  return ["--profile", profile]
}

export function dshProfileOf(requested?: string, current?: () => string, locale: Locale = DEFAULT_LOCALE): string {
  const profile = requested ?? current?.() ?? DEFAULT_PROFILE
  if (!isDshProfileName(profile)) throw new Error(ACP_DSH[locale].badProfile(JSON.stringify(profile)))
  return profile
}

function compatible(result: unknown): result is AcpInitialize {
  if (typeof result !== "object" || result === null) return false
  const version = (result as { protocolVersion?: unknown }).protocolVersion
  return version === undefined || (typeof version === "number" && version <= 1)
}

type CheckOutcome = { kind: "ready"; info: AcpInitialize } | "incompatible" | "timeout" | Error

function capabilitiesOf(info: AcpInitialize, m: Text): readonly string[] {
  const session = info.agentCapabilities?.sessionCapabilities ?? {}
  const sessions = [
    ...(Object.hasOwn(session, "list") ? [m.cap.list] : []),
    ...(info.agentCapabilities?.loadSession === true ? [m.cap.resume] : []),
    ...(Object.hasOwn(session, "fork") ? [m.cap.fork] : []),
  ]
  const sessionText = sessions.length === 0 ? m.newOnly : m.sessions(sessions)
  return [sessionText, ...(info.agentCapabilities?.promptCapabilities?.image === true ? [m.image] : [])]
}

function readyStatus(info: AcpInitialize, m: Text): DshProfileStatus {
  const identity = info.agentInfo
  const name = identity?.title ?? identity?.name
  const agent = [name, identity?.version].filter((item): item is string => item !== undefined).join(" ")
  return {
    ready: true,
    ...(agent === "" ? {} : { agent }),
    capabilities: capabilitiesOf(info, m),
  }
}

function statusOf(outcome: CheckOutcome, stderr: string, m: Text): DshProfileStatus {
  if (typeof outcome === "object" && !(outcome instanceof Error)) return readyStatus(outcome.info, m)
  const fallback =
    outcome === "timeout" ? m.timeout(CHECK_MS / 1000) : outcome === "incompatible" ? m.incompatible : outcome.message
  return { ready: false, detail: stderr.trim() || fallback }
}

function wire(child: ChildProcess, rpc: RpcPeer, output: { stderr: string }): void {
  child.stdin?.on("error", () => undefined)
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => rpc.feed(chunk))
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    output.stderr = `${output.stderr}${chunk}`.slice(-STDERR_KEEP)
  })
}

/** 真起公开 profile 并做 initialize；只读配置会漏掉插件依赖不兼容。 */
const checkProfile: DshProfileCheck = async (command, profile, locale = DEFAULT_LOCALE) => {
  const owner = createProcessOwner({
    exitGraceMs: RECLAIM_MS,
    termGraceMs: RECLAIM_MS,
    killGraceMs: RECLAIM_MS,
  })
  const state: { child: ChildProcess | undefined } = { child: undefined }
  const output: { stderr: string } = { stderr: "" }
  let timer: NodeJS.Timeout | undefined
  const rpc = createRpc({
    send: (line) => state.child?.stdin?.write(`${line}\n`),
    onNotification: () => undefined,
    onRequest: (call) => call.respond({}),
  })
  try {
    state.child = owner.spawn({ command, args: argsOf(profile), env: process.env })
    wire(state.child, rpc, output)
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), CHECK_MS)
    })
    const outcome: CheckOutcome = await Promise.race([
      rpc.call("initialize", INITIALIZE).then(
        (result) => compatible(result) ? { kind: "ready" as const, info: result } : "incompatible",
        (error: Error) => error,
      ),
      owner.died(),
      timeout,
    ])
    return statusOf(outcome, output.stderr, ACP_DSH[locale])
  } catch (error) {
    return { ready: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    state.child?.stdin?.end()
    rpc.close("DSH profile 探测结束") // i18n-ok：收摊时拒掉没回音的调用，那时已经没人在等它
    await owner.reclaim().catch(() => undefined)
  }
}

/** 探测要注入的两步，以及说话用的语言。测试换掉前两样就不必真起 DSH。 */
export interface DshProbeDeps {
  commandProbe?: DshCommandProbe
  profileCheck?: DshProfileCheck
  locale?: Locale
}

export async function probeDshAcp(command = "dsh", profile = DEFAULT_PROFILE, deps: DshProbeDeps = {}): Promise<Probe> {
  const locale = deps.locale ?? DEFAULT_LOCALE
  const m = ACP_DSH[locale]
  if (!isDshProfileName(profile)) return { state: "unavailable", detail: m.badProfile(JSON.stringify(profile)) }
  const found = await (deps.commandProbe ?? probeCommand)(command, m.install(profile), locale)
  if (found.state !== "ok" || found.path === undefined) return found
  const checked = await (deps.profileCheck ?? checkProfile)(found.path, profile, locale)
  if (checked.ready) {
    const details = [found.detail, m.handshakes(profile), checked.agent, ...(checked.capabilities ?? [])]
    return { ...found, detail: details.filter(Boolean).join(" · ") }
  }
  /*
   * **说的是「Switchback 观察到什么」，以及「下一步点哪儿」。**
   *
   * 上一版第一句是「`web` profile 还不能启动」——那是猜的：那棵 profile
   * 很可能起得好好的，只是它装的是 web 应用、根本不讲 ACP。Switchback 能确定的
   * 只有一件事：**它没应答 ACP initialize**。照实说这一件。
   *
   * 第二句给出路。「请给它加入兼容的 ACP 插件」正确但落不了地——
   * profile 是在哪儿换的、这台机器上还有哪几棵，全在设置里那一页
   *（`DshProfileSettings`），指过去就够了；Switchback 不代装插件（AGENTS.md 的产品边界）。
   */
  return {
    state: "unavailable",
    detail: [m.noAcp(profile), checked.detail].filter(Boolean).join("\n"),
  }
}

/** DSH 的协议仍由通用 ACP 驱动承担；这里只认领公开启动命令与 ACP 握手，不猜凭证状态。 */
export function createDshDriver(options: DshDriverOptions = {}): EngineDriver {
  const command = options.command ?? "dsh"
  return {
    id: "dsh",
    start: (req) => {
      const profile = dshProfileOf(req.profile, options.profile, localeOf(req))
      const driver = createAcpDriver({ id: "dsh", label: "DSH", command, args: argsOf(profile) })
      return driver.start({ ...req, profile })
    },
    probe: (locale) =>
      probeDshAcp(command, options.profile?.() ?? DEFAULT_PROFILE, {
        ...(options.commandProbe === undefined ? {} : { commandProbe: options.commandProbe }),
        ...(options.profileCheck === undefined ? {} : { profileCheck: options.profileCheck }),
        ...(locale === undefined ? {} : { locale }),
      }),
  }
}
