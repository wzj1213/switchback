import type { EngineInfo } from "@omni/protocol"
import type { Logger } from "./log.js"

interface ProbeDriver {
  probe?: () => Promise<{ state: string; detail: string }>
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
  visible: (id: string) => boolean = () => true,
): () => Promise<readonly EngineInfo[]> {
  const cached = new Map<string, Promise<EngineInfo>>()
  const reported = new Set<string>()
  return async () => {
    const entries = Object.entries(drivers).filter(([id]) => visible(id))
    const engines = await Promise.all(
      entries.map(([id, driver]) => cachedProbe(cached, id, driver, labels)),
    )
    // 探测期间用户可能又把接入关掉。**回包时再认一遍当前设置**，否则较慢的旧探测
    // 会在远程端最后写回一份过期清单（桌面还有本地过滤，远程没有）。
    const current = engines.filter((engine) => visible(engine.id))
    reportFresh(current, reported, log)
    return current
  }
}

function cachedProbe(
  cached: Map<string, Promise<EngineInfo>>,
  id: string,
  driver: ProbeDriver,
  labels: Readonly<Record<string, string>>,
): Promise<EngineInfo> {
  const found = cached.get(id)
  if (found !== undefined) return found
  const pending = inspect(id, driver, labels)
  cached.set(id, pending)
  return pending
}

async function inspect(
  id: string,
  driver: ProbeDriver,
  labels: Readonly<Record<string, string>>,
): Promise<EngineInfo> {
  const probe = await driver.probe?.().catch(() => undefined)
  return {
    id,
    label: labels[id] ?? id,
    state: (probe?.state ?? "unknown") as EngineInfo["state"],
    ...(probe?.detail === undefined ? {} : { detail: probe.detail }),
  }
}

function reportFresh(engines: readonly EngineInfo[], reported: Set<string>, log: Logger): void {
  const fresh = engines.filter((engine) => !reported.has(engine.id))
  for (const engine of fresh) reported.add(engine.id)
  if (fresh.length > 0)
    log.write("info", "engines", fresh.map((e) => `${e.id}=${e.state ?? "?"}`).join(" "))
  for (const engine of fresh) {
    if (engine.state === "missing")
      log.write("warn", "engines", `${engine.id}：${engine.detail ?? ""}`)
  }
}
