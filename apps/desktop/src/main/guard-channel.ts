import { homedir } from "node:os"
import { ipcMain } from "electron"
import type { EngineId, Event } from "@omni/protocol"
import type { Host } from "@omni/host"
import type { GuardReport } from "../shared/guard.js"
import type { Attached } from "./attached.js"
import type { Logger } from "./log.js"
import { watchEgress, type EgressGuard } from "./egress-guard.js"
import { lockCheckpoints, zcodeStatus } from "./zcode-guard.js"

/** 起外发守卫。开关不给＝开着：守卫宁可多停一次，也不放一个仓库出去。 */
export function egressFor(wiring: {
  host: Host
  emit: (event: Event) => void
  log: Logger
  stop: (() => boolean) | undefined
  labels: Readonly<Record<EngineId, string>>
}): EgressGuard {
  return watchEgress({
    processes: () => wiring.host.processes(),
    emit: wiring.emit,
    log: wiring.log,
    stop: () => wiring.stop?.() ?? true,
    label: (id) => wiring.labels[id] ?? id,
  })
}

/** 挂上设置页读账的通道；开着「给 ZCode 的快照目录上锁」就在起来时锁上。 */
export function installGuard(attached: Attached, zcodeLock: boolean, log: Logger): void {
  installGuardChannel(attached)
  if (zcodeLock) void applyZcodeLock(true, log)
}

/** 设置页「外发守卫」那一组读的东西：每个引擎进程的外发账，和 ZCode 的防护状态。 */
export function installGuardChannel(attached: Attached): void {
  ipcMain.handle("omni:guard", async (): Promise<GuardReport> => ({
    records: attached.egress.records(),
    zcode: await zcodeStatus(homedir()),
  }))
}

/**
 * 按设置给 ZCode 的快照目录上锁或解锁。
 *
 * 失败只记日志：这件事不该挡住 omni 起来。没装过 ZCode（没有 `~/.zcode`）的机器上什么都不做。
 */
export async function applyZcodeLock(on: boolean, log: Logger): Promise<void> {
  try {
    const status = await lockCheckpoints(homedir(), on)
    const { checkpoints } = status
    if (!checkpoints.exists) return
    const left = checkpoints.archives > 0 ? `；里面还有 ${String(checkpoints.archives)} 个没传出去的包，omni 没动它们` : ""
    log.write("info", "zcode", `快照目录${checkpoints.locked ? "已上锁" : "已解锁"}：${checkpoints.path}${left}`)
  } catch (error) {
    log.write("warn", "zcode", `快照目录${on ? "上锁" : "解锁"}失败：${String(error)}`)
  }
}
