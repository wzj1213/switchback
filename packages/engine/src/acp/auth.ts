import type { AcpInitialize } from "./wire.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ACP_AUTH } from "./auth.messages.js"

/**
 * ACP 的登录：agent 在握手时报出自己认的登录方式，客户端替人挑一种去办。
 *
 * ## 为什么这件事归 Switchback 做，而不算「替引擎攒功能」
 *
 * `authenticate` 是协议里的一个方法，登录方式清单是 agent 自己在 `initialize` 里报的——
 * 这就是引擎**当功能暴露出来**的那扇门。Switchback 只做两件事：把它报的清单原样摆给人看，
 * 人挑了哪一种就原样转过去。开浏览器、收回调、存凭证全是 agent 自己的事，
 * Switchback 碰不到任何一个凭证。
 *
 * ## 两种方式，走法完全不同（协议原文）
 *
 * - `agent`（缺省）：客户端发 `authenticate({ methodId })`，剩下的交给它。
 * - `terminal`：它要一个真终端跑自己的登录界面。**不能发给 `authenticate`**；
 *   客户端把它自己的启动命令**追加** `args`、叠上 `env` 在终端里再跑一遍，
 *   退出码 0 即成功，之后重新握手。实测 claude-agent-acp 0.81.2 报的就是这种：
 *   `args: ["--cli", "auth", "login", "--claudeai"]`。
 *
 * 还有一代旧写法把整条命令塞在 `_meta["terminal-auth"]` 里（`{ command, args, label }`），
 * kimi-cli 的 `kimi acp` 仍在用。它给的是**整条命令**，不是追加参数——两者不能混着拼。
 */

/** ACP 规定的「要先登录」。 */
export const AUTH_REQUIRED = -32000

/**
 * 开会话被 agent 以「要先登录」拒绝。**单独一个类型**：宿主据此报成 `unauthenticated`
 * 而不是 `crashed`——进程好好的，下一步是登录，不是去查哪儿坏了。
 */
export class AcpAuthRequired extends Error {
  /** 哪一家（驱动 id）。开会话失败时会话已经撤了，界面只能靠它认出这条说的是谁。 */
  readonly engine: string

  constructor(message: string, engine: string) {
    super(message)
    this.name = "AcpAuthRequired"
    this.engine = engine
  }
}

export interface AcpAuthMethod {
  id: string
  name: string
  description?: string
  kind: "agent" | "terminal"
  /** `terminal`：追加在引擎启动命令之后的参数。 */
  args?: readonly string[]
  /** `terminal`：叠在启动环境之上的变量，同名覆盖。 */
  env?: Readonly<Record<string, string>>
  /** 旧写法给出的整条命令。有它就用它，别再拿启动命令去拼。 */
  command?: string
  /**
   * 它在 `_meta["api-key"]` 里标明这一种要 API key。**Switchback 不代收密钥**
   * （README「不另外索要或代管凭证」），界面据此说清楚 key 得从哪儿来。
   */
  apiKey?: boolean
}

type Raw = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : undefined
}

function stringMap(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/** 旧写法：`_meta["terminal-auth"] = { command, args, label, env? }`。 */
function legacyTerminal(meta: unknown): Raw | undefined {
  if (!isRecord(meta)) return undefined
  const found = meta["terminal-auth"]
  return isRecord(found) ? found : undefined
}

function terminalParts(raw: Raw, legacy: Raw | undefined): Pick<AcpAuthMethod, "args" | "env" | "command"> {
  const source = raw["type"] === "terminal" ? raw : legacy ?? {}
  const args = strings(source["args"])
  const env = stringMap(source["env"])
  const command = legacy === undefined || raw["type"] === "terminal" ? undefined : text(legacy["command"])
  return {
    ...(args === undefined || args.length === 0 ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(command === undefined ? {} : { command }),
  }
}

/** 型认得出才往下走。`env_var` 这一型 2026-07 已从协议里拿掉；别的型更是没见过，一律不猜。 */
function knownId(raw: Raw): string | undefined {
  const type = raw["type"] ?? "agent"
  return type === "agent" || type === "terminal" ? text(raw["id"]) : undefined
}

/** 一条原始登录方式 → 规整后的一条。认不出的返回 undefined（协议要求跳过，而不是整张作废）。 */
function methodOf(raw: unknown): AcpAuthMethod | undefined {
  if (!isRecord(raw)) return undefined
  const id = knownId(raw)
  if (id === undefined) return undefined
  const legacy = legacyTerminal(raw["_meta"])
  const kind = raw["type"] === "terminal" || legacy !== undefined ? "terminal" : "agent"
  const description = text(raw["description"])
  const apiKey = isRecord(raw["_meta"]) && isRecord(raw["_meta"]["api-key"])
  return {
    id,
    name: text(raw["name"]) ?? text(legacy?.["label"]) ?? id,
    kind,
    ...(description === undefined ? {} : { description }),
    ...(kind === "terminal" ? terminalParts(raw, legacy) : {}),
    ...(apiKey ? { apiKey: true } : {}),
  }
}

/** 握手回包里的登录方式，按它报的顺序。**不排序、不挑推荐**——那是它的事。 */
export function authMethodsOf(info: AcpInitialize | undefined): readonly AcpAuthMethod[] {
  const raw = info?.authMethods
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap((one) => {
    const method = methodOf(one)
    if (method === undefined || seen.has(method.id)) return []
    seen.add(method.id)
    return [method]
  })
}

/** 它认不认 `logout`。存在即支持（`{}` 就算），和 `sessionCapabilities` 同一个约定。 */
export function canLogout(info: AcpInitialize | undefined): boolean {
  const auth = info?.agentCapabilities?.auth
  return isRecord(auth) && auth["logout"] !== undefined && auth["logout"] !== null
}

/**
 * 客户端在 `initialize` 里要声明的那一位：**能跑 terminal 型登录**。
 *
 * 不声明的话 claude-agent-acp 干脆一种登录方式都不报（实测）。新旧两种写法一起发：
 * 协议 2026-08 才把 `auth.terminal` 定下来，注册表的 CI 与不少 agent 还只认旧的 `_meta`。
 */
export const CLIENT_AUTH = {
  auth: { terminal: true },
  _meta: { "terminal-auth": true },
} as const

/**
 * 开会话撞上 `-32000` 时说的话。**它自己那句原样放在前面**——那是唯一的第一手线索
 * （实测 Gemini CLI 在这一码下说的是「这个客户端已不再支持」，根本不是「请登录」）。
 */
export function authRequiredText(
  who: string,
  methods: readonly AcpAuthMethod[],
  said: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const m = ACP_AUTH[locale]
  const offered = methods.length === 0 ? m.none : m.offered(methods.map((method) => method.name))
  return m.required(who, said, offered)
}
