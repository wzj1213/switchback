import type { EngineDriver, StartRequest } from "../contract.js"
import { probeCommand } from "../probe.js"
import { sessionPath } from "./http.js"
import { KimiServerPool, type KimiDriverConfig, type KimiLease } from "./server.js"
import { KimiSession } from "./session.js"
import { KIMI_TRUST } from "./trust.js"
import type { KimiSessionRow, KimiSnapshot, KimiStatus } from "./wire.js"

interface ConfigResponse {
  default_model?: string
}

interface Opened {
  id: string
  status: KimiStatus
  snapshot: KimiSnapshot
}

async function handleOf(lease: KimiLease, req: StartRequest): Promise<KimiSessionRow> {
  if (req.forkOf !== undefined) {
    if ((req.forkOf.dropTurns ?? 0) > 0) throw new Error("Kimi Web 只能从会话末尾分叉，不能从更早的一轮分叉")
    return lease.api.post<KimiSessionRow>(sessionPath(req.forkOf.handle, ":fork"), {})
  }
  if (req.resume !== undefined) return lease.api.get<KimiSessionRow>(sessionPath(req.resume))
  return lease.api.post<KimiSessionRow>("sessions", { metadata: { cwd: req.cwd } })
}

function verifyCwd(row: KimiSessionRow, cwd: string): void {
  if (row.metadata.cwd !== cwd) {
    throw new Error(`Kimi 会话属于 ${row.metadata.cwd}，不能当成 ${cwd} 的会话续跑`)
  }
}

async function open(lease: KimiLease, req: StartRequest): Promise<Opened> {
  const row = await handleOf(lease, req)
  try {
    verifyCwd(row, req.cwd)
    const [before, config] = await Promise.all([
      lease.api.get<KimiStatus>(sessionPath(row.id, "/status")),
      lease.api.get<ConfigResponse>("config"),
    ])
    if (before.busy) throw new Error("这条 Kimi 会话正在另一个界面里运行，请等它停下后再接入 omni")
    const model = before.model === undefined || before.model === "" ? config.default_model : undefined
    const target = KIMI_TRUST[req.trust]
    await lease.api.post(sessionPath(row.id, "/profile"), {
      agent_config: { ...target, ...(model === undefined ? {} : { model }) },
    })
    const status = await lease.api.get<KimiStatus>(sessionPath(row.id, "/status"))
    if (status.model === undefined || status.model === "") {
      throw new Error("Kimi 没有可用的默认模型；请先在 Kimi Code 里完成登录和模型配置")
    }
    const snapshot = await lease.api.get<KimiSnapshot>(sessionPath(row.id, "/snapshot"))
    if (snapshot.in_flight_turn !== null) throw new Error("这条 Kimi 会话仍有一轮在运行，暂时不能接入 omni")
    return { id: row.id, status, snapshot }
  } catch (error) {
    if (req.resume === undefined) await lease.api.post(sessionPath(row.id, ":archive"), {}).catch(() => undefined)
    throw error
  }
}

export function createKimiDriver(config: KimiDriverConfig = {}): EngineDriver {
  const pool = new KimiServerPool(config)
  return {
    id: "kimi",
    probe: () => probeCommand(config.command ?? "kimi", "安装或升级 Kimi Code 后重启 omni。"),
    start: async (req) => {
      req.emit({ type: "engine.status", at: Date.now(), threadId: req.threadId, status: "starting" })
      const lease = await pool.acquire()
      let session: KimiSession | undefined
      try {
        const init = await open(lease, req)
        session = new KimiSession(req, lease, init)
        await session.start()
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
