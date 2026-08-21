import type { ClaudeExecutable } from "@omni/engine"
import { ipcMain } from "electron"
import {
  compare,
  npmGlobalState,
  runCommand,
  versionOf,
  type EngineCommandResult,
  type EngineCommandRunner,
} from "./enginever-command.js"
import {
  specs,
  type EngineSpec,
  type EngineVersion,
  type InspectContext,
} from "./enginever-sources.js"
import type { Logger } from "./log.js"

export type { EngineCommandResult, EngineCommandRunner, EngineVersion }

export interface UpdateResult {
  ok: boolean
  changed: boolean
  before?: string
  after?: string
  /** 引擎更新器或包管理器的原文；失败时直接给用户排查。 */
  output: string
}

export interface EngineVersionOptions {
  claudeExecutable?: ClaudeExecutable
  run?: EngineCommandRunner
  now?: () => number
}

export interface EngineVersionStore {
  get: (refresh?: boolean) => Promise<readonly EngineVersion[]>
  update: (engine: string) => Promise<UpdateResult>
  warm: () => void
}

const TTL_MS = 6 * 60 * 60 * 1000
const UPDATE_MS = 180_000

/**
 * 探测结果缓存在这个对象里，不挂模块级可变状态。
 * `inflight` 让启动预热和设置页手动检查不会同时跑两遍网络请求。
 */
export function createEngineVersions(
  log: Logger,
  options: EngineVersionOptions = {},
): EngineVersionStore {
  let cached: { at: number; list: readonly EngineVersion[] } | undefined
  let inflight: Promise<readonly EngineVersion[]> | undefined
  const run = options.run ?? runCommand
  const now = options.now ?? Date.now
  const known = specs(options.claudeExecutable ?? "bundled")

  const inspectContext = (): InspectContext => ({ run, npmGlobal: npmGlobalState(run) })

  const probeAll = async (): Promise<readonly EngineVersion[]> => {
    const context = inspectContext()
    const list = (await Promise.all(known.map((spec) => spec.inspect(context)))).filter(isPresent)
    for (const version of list) {
      if (version.stale) {
        log.write(
          "info",
          "engines",
          `${version.engine} 有新版：${version.installed ?? "?"} → ${version.latest ?? "?"}`,
        )
      }
    }
    cached = { at: now(), list }
    return list
  }

  const get = async (refresh = false): Promise<readonly EngineVersion[]> => {
    if (!refresh && cached !== undefined && now() - cached.at < TTL_MS) return cached.list
    inflight ??= probeAll().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  const update = async (engine: string): Promise<UpdateResult> => {
    const spec = known.find((candidate) => candidate.engine === engine)
    if (spec?.update === undefined) return unavailable(engine)
    const before = await versionOf(spec.bin, run)
    log.write("info", "engines", `开始更新 ${engine}（当前 ${before ?? "未知"}）`)
    const command = await run(spec.update.command, spec.update.args, UPDATE_MS)
    const after = await versionOf(spec.bin, run)
    const current = await spec.inspect(inspectContext())
    const changed = after !== undefined && (before === undefined || compare(after, before) > 0)
    const ok = updateSucceeded({ spec, command, current, after, changed })
    cached = undefined
    void get().catch(() => undefined)
    log.write(
      ok ? "info" : "error",
      "engines",
      `更新 ${engine}：${before ?? "?"} → ${after ?? "?"}`,
    )
    return {
      ok,
      changed,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      output: updateOutput(command.output, ok, before, after),
    }
  }

  return { get, update, warm: () => void get().catch(() => undefined) }
}

export function installEngineVersionChannel(_log: Logger, versions: EngineVersionStore): void {
  ipcMain.handle("omni:updateEngine", (_event, engine: string) => versions.update(engine))
  ipcMain.handle("omni:engineVersions", (_event, refresh?: boolean) =>
    versions.get(refresh === true),
  )
}

interface UpdateVerification {
  spec: EngineSpec
  command: EngineCommandResult
  current: EngineVersion | undefined
  after: string | undefined
  changed: boolean
}

function updateSucceeded(check: UpdateVerification): boolean {
  const { spec, command, current, after, changed } = check
  const currentEnough = current?.latest === undefined || current.stale === false
  return (
    command.ok &&
    after !== undefined &&
    currentEnough &&
    (changed || spec.update?.unchangedOk === true)
  )
}

function unavailable(engine: string): UpdateResult {
  return { ok: false, changed: false, output: `${engine} 当前没有可由 omni 执行的更新入口` }
}

function updateOutput(
  output: string,
  ok: boolean,
  before: string | undefined,
  after: string | undefined,
): string {
  if (ok) return output === "" ? "更新器正常结束，没有额外输出。" : output
  const checked = `omni 复查版本：${before ?? "?"} → ${after ?? "?"}`
  return [output === "" ? "更新命令没有输出。" : output, checked].join("\n\n")
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}
