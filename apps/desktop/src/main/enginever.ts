import type { ClaudeExecutable } from "@switchback/engine"
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
  missingOf,
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
  /**
   * 装成功 / 更新成功之后喊一声。
   *
   * **不喊的后果是这个仓库里最尴尬的一个 bug**：在设置页点「安装」，装成功了，
   * 这一行的版本号也更新了，而引擎下拉里那家**still 写着「未安装」**——
   * 因为 `engine-catalog` 有自己的一份缓存，进程内永久有效，
   * 除了 DSH 改 profile 之外没有任何东西让它失效。于是 codex 那条安装提示
   * 只能写成「装好之后重启 Switchback」——那是把缺陷写进了说明书。
   *
   * 用回调而不是在这里直接调宿主：这个 store 在宿主起来**之前**就建好了
   *（通道要先挂），拿不到 `attached`。index.ts 用一个可变槽把环解开。
   */
  onChanged?: () => void
}

export interface EngineVersionStore {
  get: (refresh?: boolean) => Promise<readonly EngineVersion[]>
  update: (engine: string) => Promise<UpdateResult>
  /** 装一家还没装的。见 `EngineVersion.install`。 */
  install: (engine: string) => Promise<UpdateResult>
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
    const list = await probe(known, inspectContext(), log)
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

  /**
   * 装完 / 更新完的收尾。**三件事一直是同一套**，原来在 `install` 与 `update`
   * 里各写一遍——而「喊 onChanged」这一条加进来时，两处都得记得加。
   * 一个值只该有一个改它的地方。
   */
  const settle = (ok: boolean): void => {
    cached = undefined
    void get().catch(() => undefined)
    // 成功了才喊：没成的时候机器上什么都没变，重探一遍只是白跑几个子进程
    if (ok) options.onChanged?.()
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
    // 更新成功也要重探：版本变了，probe 缓存里那条 detail（含绝对路径与版本号）就过期了
    settle(ok)
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

  const install = async (engine: string): Promise<UpdateResult> => {
    const spec = known.find((candidate) => candidate.engine === engine)
    if (spec?.install === undefined) return noInstaller(engine)
    const done = await runInstall(spec, { run, log })
    settle(done.ok)
    return done
  }

  return { get, update, install, warm: () => void get().catch(() => undefined) }
}

/**
 * 装一家还没装的。
 *
 * 和 `update` 分开而不是复用：**判据不一样**。更新成功的判据是「版本变新了」，
 * 而安装成功的判据是「之前压根没有、现在有了」——拿更新那套去判安装，
 * 一次成功的安装会被报成「没更新成」。
 */
async function runInstall(
  spec: EngineSpec,
  deps: { run: EngineCommandRunner; log: Logger },
): Promise<UpdateResult> {
  const step = spec.install
  if (step === undefined) return noInstaller(spec.engine)
  const before = await versionOf(spec.bin, deps.run)
  deps.log.write("info", "engines", `开始安装 ${spec.engine}`)
  const command = await deps.run(step.command, step.args, UPDATE_MS)
  const after = await versionOf(spec.bin, deps.run)
  const ok = command.ok && after !== undefined
  deps.log.write(ok ? "info" : "error", "engines", `安装 ${spec.engine}：${after ?? "仍然探不到"}`)
  return {
    ok,
    changed: ok && before === undefined,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    output: installOutput(command.output, ok),
  }
}

/**
 * 探一遍。
 *
 * **探不到的那一家不丢掉，换成「没装」那一行。** 丢掉等于「Switchback 不知道有这一家」，
 * 而事实是它知道得很清楚——它只是没装，而那一行上正好能摆下一条安装命令。
 */
async function probe(
  known: readonly EngineSpec[],
  context: InspectContext,
  log: Logger,
): Promise<readonly EngineVersion[]> {
  const list = (
    await Promise.all(known.map(async (spec) => (await spec.inspect(context)) ?? missingOf(spec)))
  ).filter(isPresent)
  for (const version of list) {
    if (!version.stale) continue
    log.write(
      "info",
      "engines",
      `${version.engine} 有新版：${version.installed ?? "?"} → ${version.latest ?? "?"}`,
    )
  }
  return list
}

function noInstaller(engine: string): UpdateResult {
  return { ok: false, changed: false, output: `Switchback 不知道 ${engine} 的安装来源，这一家要按它自己的方式装` }
}

function installOutput(output: string, ok: boolean): string {
  if (ok) return output === "" ? "安装器正常结束，没有额外输出。" : output
  const checked = "Switchback 复查：装完之后仍然探不到这个命令。可能装在了不在 PATH 上的位置。"
  return [output === "" ? "安装命令没有输出。" : output, checked].join("\n\n")
}

export function installEngineVersionChannel(_log: Logger, versions: EngineVersionStore): void {
  ipcMain.handle("switchback:updateEngine", (_event, engine: string) => versions.update(engine))
  ipcMain.handle("switchback:installEngine", (_event, engine: string) => versions.install(engine))
  ipcMain.handle("switchback:engineVersions", (_event, refresh?: boolean) =>
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
  return { ok: false, changed: false, output: `${engine} 当前没有可由 Switchback 执行的更新入口` }
}

function updateOutput(
  output: string,
  ok: boolean,
  before: string | undefined,
  after: string | undefined,
): string {
  if (ok) return output === "" ? "更新器正常结束，没有额外输出。" : output
  const checked = `Switchback 复查版本：${before ?? "?"} → ${after ?? "?"}`
  return [output === "" ? "更新命令没有输出。" : output, checked].join("\n\n")
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}
