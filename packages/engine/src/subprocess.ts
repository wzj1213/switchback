import { spawn, type ChildProcess } from "node:child_process"
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk"

export interface ReclaimConfig {
  /** SDK 的 stdin-EOF 优雅窗口之后，我们再等多久让它自己退 */
  exitGraceMs: number
  /** SIGTERM 之后等多久再升级到 SIGKILL */
  termGraceMs: number
  /** SIGKILL 之后等多久确认整树消失 */
  killGraceMs: number
}

const DEFAULTS: ReclaimConfig = { exitGraceMs: 3000, termGraceMs: 3000, killGraceMs: 1000 }

/** 走到了阶梯的哪一级。`escaped` 是失败——必须上报，不能当成正常。 */
export type Rung = "never-spawned" | "already-exited" | "graceful" | "sigterm" | "sigkill" | "escaped"

export interface ReclaimReport {
  rung: Rung
  pid: number | undefined
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
}

export interface ProcessOwner {
  /** 交给 SDK 的 `spawnClaudeCodeProcess` */
  spawn: (options: SpawnOptions) => SpawnedProcess
  /** 回收阶梯。幂等；返回时要么有退出证明，要么 rung 是 `escaped`。 */
  reclaim: () => Promise<ReclaimReport>
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 整个进程组还活着吗。
 *
 * `kill(-pid, 0)` 不发信号，只做存在性探测：ESRCH 表示组里一个都不剩。
 * 这就是**整树退出证明**——只看直接子进程的 exitCode 是不够的，
 * claude 自己会 spawn bash 之类的孙子进程，父进程死了它们可能还在跑。
 */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // 已经没了。探测和发信号之间有竞态，这不是错误。
  }
}

interface Owned {
  child: ChildProcess
  exited: boolean
  code: number | null
  signal: NodeJS.Signals | null
}

export function createProcessOwner(config: Partial<ReclaimConfig> = {}): ProcessOwner {
  const cfg = { ...DEFAULTS, ...config }
  const state: { owned: Owned | undefined } = { owned: undefined }

  const doSpawn = (options: SpawnOptions): SpawnedProcess => {
    // detached: true 让子进程成为新进程组的组长，我们才能用负 pid 一次收掉整棵树。
    // 代价：omni 硬崩时子进程不会被系统连坐带走——这是有意的取舍，见 README。
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    })
    const owned: Owned = { child, exited: false, code: null, signal: null }
    child.on("exit", (code, signal) => {
      owned.exited = true
      owned.code = code
      owned.signal = signal
    })
    state.owned = owned
    return child as unknown as SpawnedProcess
  }

  const report = (rung: Rung, started: number): ReclaimReport => {
    const owned = state.owned
    return {
      rung,
      pid: owned?.child.pid,
      exitCode: owned?.code ?? null,
      signal: owned?.signal ?? null,
      durationMs: Date.now() - started,
    }
  }

  /** 轮询等待整组消失，最多 `budget` 毫秒。返回是否等到了。 */
  const settle = async (pid: number, budget: number): Promise<boolean> => {
    const deadline = Date.now() + budget
    while (Date.now() < deadline) {
      if (!groupAlive(pid)) return true
      await wait(50)
    }
    return !groupAlive(pid)
  }

  const reclaim = async (): Promise<ReclaimReport> => {
    const started = Date.now()
    const owned = state.owned
    if (owned === undefined) return report("never-spawned", started)
    const pid = owned.child.pid
    if (pid === undefined) return report("already-exited", started)
    if (!groupAlive(pid)) return report("already-exited", started)

    if (await settle(pid, cfg.exitGraceMs)) return report("graceful", started)
    signalGroup(pid, "SIGTERM")
    if (await settle(pid, cfg.termGraceMs)) return report("sigterm", started)
    signalGroup(pid, "SIGKILL")
    if (await settle(pid, cfg.killGraceMs)) return report("sigkill", started)
    return report("escaped", started)
  }

  return { spawn: doSpawn, reclaim }
}
