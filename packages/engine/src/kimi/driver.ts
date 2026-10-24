import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import type { EngineDriver, StartRequest } from "../contract.js"
import { localeOf } from "../locale.js"
import { probeCommand } from "../probe.js"
import { PROBE } from "../probe.messages.js"
import { KIMI_DRIVER } from "./driver.messages.js"
import { sessionPath } from "./http.js"
import { loadKimiMcpSnapshot, type KimiMcpSnapshot } from "./mcp-status.js"
import { KimiServerPool, type KimiDriverConfig, type KimiLease } from "./server.js"
import { KimiSession } from "./session.js"
import { KIMI_TRUST } from "./trust.js"
import type {
  KimiGoalSnapshot, KimiSessionRow, KimiSnapshot, KimiStatus, KimiTasksResponse, KimiWarningsResponse,
} from "./wire.js"

interface ConfigResponse {
  default_model?: string
}

interface Opened {
  id: string
  status: KimiStatus
  snapshot: KimiSnapshot
  goal?: KimiGoalSnapshot | null
  mcp?: KimiMcpSnapshot
  tasks?: KimiTasksResponse
  warnings?: KimiWarningsResponse
}

async function handleOf(lease: KimiLease, req: StartRequest): Promise<KimiSessionRow> {
  if (req.forkOf !== undefined) {
    if ((req.forkOf.dropTurns ?? 0) > 0) throw new Error(KIMI_DRIVER[localeOf(req)].tailOnly)
    return lease.api.post<KimiSessionRow>(sessionPath(req.forkOf.handle, ":fork"), {})
  }
  if (req.resume !== undefined) return lease.api.get<KimiSessionRow>(sessionPath(req.resume))
  return lease.api.post<KimiSessionRow>("sessions", { metadata: { cwd: req.cwd } })
}

function verifyCwd(row: KimiSessionRow, cwd: string, m: (typeof KIMI_DRIVER)[Locale]): void {
  if (row.metadata.cwd !== cwd) throw new Error(m.wrongCwd(row.metadata.cwd, cwd))
}

async function open(lease: KimiLease, req: StartRequest): Promise<Opened> {
  const row = await handleOf(lease, req)
  const m = KIMI_DRIVER[localeOf(req)]
  try {
    verifyCwd(row, req.cwd, m)
    const [before, config] = await Promise.all([
      lease.api.get<KimiStatus>(sessionPath(row.id, "/status")),
      lease.api.get<ConfigResponse>("config"),
    ])
    if (before.busy) throw new Error(m.busy)
    const model = before.model === undefined || before.model === "" ? config.default_model : undefined
    const target = KIMI_TRUST[req.trust]
    await lease.api.post(sessionPath(row.id, "/profile"), {
      agent_config: { ...target, ...(model === undefined ? {} : { model }) },
    })
    const [status, snapshot, goal, tasks, warnings] = await Promise.all([
      lease.api.get<KimiStatus>(sessionPath(row.id, "/status")),
      lease.api.get<KimiSnapshot>(sessionPath(row.id, "/snapshot")),
      lease.api.get<KimiGoalSnapshot | null>(sessionPath(row.id, "/goal")).catch(() => undefined),
      lease.api.get<KimiTasksResponse>(sessionPath(row.id, "/tasks")).catch(() => undefined),
      lease.api.get<KimiWarningsResponse>(sessionPath(row.id, "/warnings")).catch(() => undefined),
    ])
    if (status.model === undefined || status.model === "") throw new Error(m.noModel)
    if (snapshot.in_flight_turn !== null) throw new Error(m.inFlight)
    const mcp = await loadKimiMcpSnapshot(lease.api, row.id).catch(() => undefined)
    return {
      id: row.id, status, snapshot,
      ...(goal === undefined ? {} : { goal }),
      mcp,
      tasks,
      ...(warnings === undefined ? {} : { warnings }),
    }
  } catch (error) {
    if (req.resume === undefined) await lease.api.post(sessionPath(row.id, ":archive"), {}).catch(() => undefined)
    throw error
  }
}

export function createKimiDriver(config: KimiDriverConfig = {}): EngineDriver {
  const pool = new KimiServerPool(config)
  return {
    id: "kimi",
    // 同 codex：装完不再需要重启，见那边的注释
    probe: (locale) => probeCommand(config.command ?? "kimi", PROBE[locale ?? DEFAULT_LOCALE].installHint, locale),
    start: async (req) => {
      req.emit({ type: "engine.status", at: Date.now(), threadId: req.threadId, status: "starting" })
      const lease = await pool.acquire(() => localeOf(req))
      let session: KimiSession | undefined
      try {
        const init = await open(lease, req)
        session = new KimiSession(req, lease, init)
        return session
      } catch (error) {
        if (session === undefined) await lease.release().catch(() => undefined)
        else {
          if (req.resume === undefined) await session.discard().catch(() => undefined)
          await session.dispose().catch(() => undefined)
        }
        throw error
      }
    },
  }
}

export type { KimiDriverConfig } from "./server.js"
