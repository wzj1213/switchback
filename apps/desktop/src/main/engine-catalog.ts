import type { EngineInfo } from "@omni/protocol"
import type { Logger } from "./log.js"

interface ProbeDriver {
  probe?: () => Promise<{ state: string; detail: string }>
}

interface CatalogOptions {
  visible?: (id: string) => boolean
  revision?: (id: string) => string
  /** 把 profile 同时纳入缓存边界和返回值，渲染层才能识别切换期间的旧结果。 */
  profile?: (id: string) => string | undefined
}

export interface EngineCatalog {
  (): Promise<readonly EngineInfo[]>
  /** 原生配置或插件树变了；下一次读取必须真探，不能复用旧结论。 */
  invalidate: (id: string) => void
}

/**
 * 按当前设置列出引擎，每一家只探一次。
 *
 * 未接入的 DSH 连探测进程都不起；后来确认接入时才建立它自己的缓存项。
 */
export function createEngineCatalog(
  drivers: Readonly<Record<string, ProbeDriver>>,
  labels: Readonly<Record<string, string>>,
  log: Logger,
  options: CatalogOptions = {},
): EngineCatalog {
  const cached = new Map<string, Promise<EngineInfo>>()
  const generation = new Map<string, number>()
  const reported = new Map<string, string>()
  const visible = options.visible ?? (() => true)
  const read = async (): Promise<readonly EngineInfo[]> => {
    const entries = Object.entries(drivers)
      .filter(([id]) => visible(id))
      .map(([id, driver]) => {
        const profile = options.profile?.(id)
        return { id, driver, profile, revision: revisionOf(options, generation, id, profile) }
      })
    const inspected = await Promise.all(
      entries.map(async ({ id, driver, profile, revision }) => ({
        engine: await cachedProbe(cached, {
          key: `${id}\0${revision}`, id, driver, labels,
          ...(profile === undefined ? {} : { profile }),
        }),
        revision,
      })),
    )
    // 探测期间用户可能又把接入关掉。**回包时再认一遍当前设置**，否则较慢的旧探测
    // 会在远程端最后写回一份过期清单（桌面还有本地过滤，远程没有）。
    const current = inspected
      .filter(({ engine, revision }) =>
        visible(engine.id) &&
        revisionOf(options, generation, engine.id, options.profile?.(engine.id)) === revision,
      )
      .map(({ engine }) => engine)
    reportFresh(current, reported, log)
    return current
  }
  return Object.assign(read, {
    invalidate: (id: string) => invalidate(cached, generation, id),
  })
}

function revisionOf(
  options: CatalogOptions,
  generation: ReadonlyMap<string, number>,
  id: string,
  profile?: string,
): string {
  return `${options.revision?.(id) ?? profile ?? ""}\0${String(generation.get(id) ?? 0)}`
}

function invalidate(
  cached: Map<string, Promise<EngineInfo>>,
  generation: Map<string, number>,
  id: string,
): void {
  generation.set(id, (generation.get(id) ?? 0) + 1)
  for (const key of cached.keys()) if (key.startsWith(`${id}\0`)) cached.delete(key)
}

function cachedProbe(
  cached: Map<string, Promise<EngineInfo>>,
  req: {
    key: string
    id: string
    driver: ProbeDriver
    labels: Readonly<Record<string, string>>
    profile?: string
  },
): Promise<EngineInfo> {
  const found = cached.get(req.key)
  if (found !== undefined) return found
  const pending = inspect(req.id, req.driver, req.labels, req.profile)
  cached.set(req.key, pending)
  return pending
}

async function inspect(
  id: string,
  driver: ProbeDriver,
  labels: Readonly<Record<string, string>>,
  profile?: string,
): Promise<EngineInfo> {
  const probe = await driver.probe?.().catch(() => undefined)
  return {
    id,
    label: labels[id] ?? id,
    ...(profile === undefined ? {} : { profile }),
    state: (probe?.state ?? "unknown") as EngineInfo["state"],
    ...(probe?.detail === undefined ? {} : { detail: probe.detail }),
  }
}

function reportFresh(engines: readonly EngineInfo[], reported: Map<string, string>, log: Logger): void {
  const fresh = engines.filter((engine) => {
    const key = `${engine.id}\0${engine.profile ?? ""}`
    const value = `${engine.state ?? ""}\0${engine.detail ?? ""}`
    if (reported.get(key) === value) return false
    reported.set(key, value)
    return true
  })
  if (fresh.length > 0)
    log.write("info", "engines", fresh.map((e) => `${e.id}=${e.state ?? "?"}`).join(" "))
  for (const engine of fresh) {
    if (engine.state === "missing" || engine.state === "unavailable")
      log.write("warn", "engines", `${engine.id}：${engine.detail ?? ""}`)
  }
}
