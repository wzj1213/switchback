import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseRegistry, type RegistryAgent } from "./acp-registry-model.js"
import type { Logger } from "./log.js"

/**
 * 取 ACP 注册表，并在本机留一份。
 *
 * ## 什么时候联网
 *
 * **只在你打开「安装与接入」、而本机那份超过一小时的时候**，或者你点了「刷新」。
 * 不在启动时取、不在后台轮询：一年接几次引擎的事不值得常驻一条网络请求。
 * 这一条写进了 README 的「网络」一节。
 *
 * ## 离线
 *
 * 取不到就给本机那份，并把「取不到」和「这份是什么时候的」一起摆出来——
 * 用户常在没网的地方用 omni，一份旧清单照样能看、能照着接（npx 缓存过的也照样能起）。
 */
export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"
const CACHE_FILE = "acp-registry.json"
const STALE_MS = 60 * 60_000
const FETCH_MS = 15_000
/** 现在这份约 60 KB。大出两个数量级就不是注册表了，不往盘上写。 */
const MAX_BYTES = 4_000_000

export interface RegistrySnapshot {
  agents: readonly RegistryAgent[]
  fetchedAt?: number
  source: "network" | "cache" | "none"
  error?: string
}

interface Cached {
  fetchedAt: number
  registry: unknown
}

export interface RegistryDeps {
  dir: string
  fetch: typeof fetch
  now: () => number
  log: Logger
}

async function readCache(dir: string): Promise<Cached | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(dir, CACHE_FILE), "utf8")) as Partial<Cached>
    return typeof raw.fetchedAt === "number" ? { fetchedAt: raw.fetchedAt, registry: raw.registry } : undefined
  } catch {
    return undefined
  }
}

async function download(deps: RegistryDeps): Promise<unknown> {
  const response = await deps.fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`注册表返回 HTTP ${String(response.status)}`)
  const body = await response.text()
  if (body.length > MAX_BYTES) throw new Error("注册表大得不正常，没有采用")
  return JSON.parse(body) as unknown
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /abort|timeout/iu.test(message) ? "15 秒内没取到" : message
}

export function createAcpRegistry(deps: RegistryDeps): { read: (force?: boolean) => Promise<RegistrySnapshot> } {
  const read = async (force = false): Promise<RegistrySnapshot> => {
    const cached = await readCache(deps.dir)
    const fresh = cached !== undefined && deps.now() - cached.fetchedAt < STALE_MS
    if (!force && fresh) {
      return { agents: parseRegistry(cached.registry), fetchedAt: cached.fetchedAt, source: "cache" }
    }
    try {
      const registry = await download(deps)
      const fetchedAt = deps.now()
      const agents = parseRegistry(registry)
      // 一家都认不出的不写盘：别拿一份坏的盖掉还能用的那份
      if (agents.length > 0) await writeFile(join(deps.dir, CACHE_FILE), JSON.stringify({ fetchedAt, registry }), "utf8")
      return { agents, fetchedAt, source: "network" }
    } catch (error) {
      const why = `取不到 ACP 注册表（${reason(error)}）`
      deps.log.write("warn", "registry", why)
      if (cached === undefined) return { agents: [], source: "none", error: `${why}。联网后点「刷新」再试。` }
      return { agents: parseRegistry(cached.registry), fetchedAt: cached.fetchedAt, source: "cache", error: `${why}，下面是本机存的那份。` }
    }
  }
  return { read }
}
