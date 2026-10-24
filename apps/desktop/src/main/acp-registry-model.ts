import type { LaunchPlan } from "../shared/acp-registry.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ACP_PLAN } from "./acp-registry-model.messages.js"

/**
 * ACP 官方注册表（`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`）的**纯解析**。
 *
 * ## 为什么读它不算「把别人的命令行抄进代码」
 *
 * `engines.ts` 开头那段反对的是 Switchback **内置**一张「谁用什么参数进 ACP 模式」的表：
 * 对方改一次参数我们就得发一版补丁。注册表是 ACP 协议组织维护、各家 agent 自己提交的清单，
 * 每小时自动跟版本，CI 还会逐家验握手——**怎么起它，是它自己在那儿声明的**。
 * Switchback 运行时去读、原样照做，代码里一条命令都不写。
 *
 * ## 每个字段都当不可信输入
 *
 * id 与版本会变成目录名和 JSON 键，`cmd` 会变成要执行的路径，`archive` 会被下载。
 * 所以这里宁可丢掉一家，也不放过一个带 `..`、绝对路径或非 https 的字段——
 * 丢掉的代价是清单里少一行，放过的代价是往 Switchback 的数据目录外面写文件。
 */

export type RegistryPlatform =
  | "darwin-aarch64" | "darwin-x86_64" | "linux-aarch64" | "linux-x86_64" | "windows-aarch64" | "windows-x86_64"

interface PackageDist {
  package: string
  args: readonly string[]
  env?: Readonly<Record<string, string>>
}

export interface BinaryDist {
  archive: string
  cmd: string
  args: readonly string[]
  env?: Readonly<Record<string, string>>
  sha256?: string
}

export interface RegistryAgent {
  id: string
  name: string
  version: string
  description?: string
  repository?: string
  website?: string
  license?: string
  authors: readonly string[]
  npx?: PackageDist
  uvx?: PackageDist
  binary: Readonly<Partial<Record<RegistryPlatform, BinaryDist>>>
}

type Raw = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)

/** 会变成目录名 / JSON 键的那几个字段：只许常见字符，不许 `.` 开头（挡住 `..`）。 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/u
const SHA256 = /^[0-9a-fA-F]{64}$/u

export function platformOf(platform: string, arch: string): RegistryPlatform | undefined {
  const os = ({ darwin: "darwin", linux: "linux", win32: "windows" } as Readonly<Record<string, string>>)[platform]
  const cpu = ({ arm64: "aarch64", x64: "x86_64" } as Readonly<Record<string, string>>)[arch]
  return os === undefined || cpu === undefined ? undefined : (`${os}-${cpu}` as RegistryPlatform)
}

function argsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []
}

function envOf(value: unknown): { env?: Readonly<Record<string, string>> } {
  if (!isRecord(value)) return {}
  const pairs = Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === "string")
  return pairs.length === 0 ? {} : { env: Object.fromEntries(pairs) }
}

/** npx / uvx 的包名。以 `-` 开头会被当成 npx 自己的选项，一律不收。 */
function packageOf(value: unknown): PackageDist | undefined {
  if (!isRecord(value)) return undefined
  const name = text(value["package"])
  if (name === undefined || name.startsWith("-") || /\s/u.test(name)) return undefined
  return { package: name, args: argsOf(value["args"]), ...envOf(value["env"]) }
}

/** 归档里那个可执行文件的相对路径：不许绝对路径、不许 `..`。 */
function relativeCmd(value: unknown): string | undefined {
  const cmd = text(value)
  if (cmd === undefined || cmd.startsWith("/") || cmd.includes("\\") || /^[A-Za-z]:/u.test(cmd)) return undefined
  return cmd.split("/").some((part) => part === "..") ? undefined : cmd
}

function binaryOf(value: unknown): BinaryDist | undefined {
  if (!isRecord(value)) return undefined
  const archive = text(value["archive"])
  const cmd = relativeCmd(value["cmd"])
  if (archive === undefined || !archive.startsWith("https://") || cmd === undefined) return undefined
  const sha = text(value["sha256"])
  return {
    archive,
    cmd,
    args: argsOf(value["args"]),
    ...envOf(value["env"]),
    ...(sha !== undefined && SHA256.test(sha) ? { sha256: sha.toLowerCase() } : {}),
  }
}

function binariesOf(value: unknown): RegistryAgent["binary"] {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([platform, dist]) => {
      const parsed = binaryOf(dist)
      return parsed === undefined ? [] : [[platform, parsed]]
    }),
  )
}

function optional(raw: Raw, keys: readonly ("description" | "repository" | "website" | "license")[]): Partial<RegistryAgent> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = text(raw[key])
    return value === undefined ? [] : [[key, value]]
  }))
}

function agentOf(raw: unknown): RegistryAgent | undefined {
  if (!isRecord(raw)) return undefined
  const id = text(raw["id"])
  const version = text(raw["version"])
  if (id === undefined || version === undefined || !SAFE_NAME.test(id) || !SAFE_NAME.test(version)) return undefined
  const dist = isRecord(raw["distribution"]) ? raw["distribution"] : {}
  const npx = packageOf(dist["npx"])
  const uvx = packageOf(dist["uvx"])
  return {
    id,
    name: text(raw["name"]) ?? id,
    version,
    ...optional(raw, ["description", "repository", "website", "license"]),
    authors: argsOf(raw["authors"]),
    ...(npx === undefined ? {} : { npx }),
    ...(uvx === undefined ? {} : { uvx }),
    binary: binariesOf(dist["binary"]),
  }
}

/** 整份注册表 → 认得出的那几家，按名字排好。重复的 id 只留第一条。 */
export function parseRegistry(raw: unknown): readonly RegistryAgent[] {
  const list = isRecord(raw) && Array.isArray(raw["agents"]) ? raw["agents"] : []
  const seen = new Set<string>()
  const agents = list.flatMap((one) => {
    const agent = agentOf(one)
    if (agent === undefined || seen.has(agent.id)) return []
    seen.add(agent.id)
    return [agent]
  })
  return agents.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
}

/**
 * 这台机器上怎么起它。
 *
 * **有 npx / uvx 就优先用它们**：它们走你自己的 npm / pip 配置（镜像、代理都照旧），
 * 而二进制要从 GitHub 之类的地方直接下载，网络环境不好时更容易失败。
 * 没有启动器、或者这家只发二进制，才下载本平台的包。都没有就照实说少了什么。
 */
export function planOf(
  agent: RegistryAgent,
  platform: RegistryPlatform | undefined,
  has: { npx: boolean; uvx: boolean },
  locale: Locale = DEFAULT_LOCALE,
): { plan?: LaunchPlan; missing?: string } {
  if (agent.npx !== undefined && has.npx) {
    const { package: pkg, args, env } = agent.npx
    return { plan: { kind: "npx", command: "npx", args: ["-y", pkg, ...args], package: pkg, ...(env === undefined ? {} : { env }) } }
  }
  if (agent.uvx !== undefined && has.uvx) {
    const { package: pkg, args, env } = agent.uvx
    return { plan: { kind: "uvx", command: "uvx", args: [pkg, ...args], package: pkg, ...(env === undefined ? {} : { env }) } }
  }
  const binary = platform === undefined ? undefined : agent.binary[platform]
  if (binary !== undefined) return { plan: { kind: "binary", ...binary } }
  const m = ACP_PLAN[locale]
  if (agent.npx !== undefined) return { missing: m.noNpx }
  if (agent.uvx !== undefined) return { missing: m.noUvx }
  return { missing: m.noBuild }
}
