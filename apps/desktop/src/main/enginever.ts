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
import type { Channels } from "./channels.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ENGINE_VERSION } from "./enginever.messages.js"
import { VERSION_NOTE } from "./enginever-sources.messages.js"

type Text = (typeof ENGINE_VERSION)[Locale]

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
  /** 装完、更新完接在输出后面那句话用哪种语言，每次现读。缺省中文。 */
  locale?: () => Locale
}

export interface EngineVersionStore {
  get: (refresh?: boolean) => Promise<readonly EngineVersion[]>
  update: (engine: string) => Promise<UpdateResult>
  /** 装一家还没装的。见 `EngineVersion.install`。 */
  install: (engine: string) => Promise<UpdateResult>
  warm: () => void
}

const TTL_MS = 6 * 60 * 60 * 1000
const textOf = (options: EngineVersionOptions): Text => ENGINE_VERSION[options.locale?.() ?? DEFAULT_LOCALE]
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
    if (!refresh && cached !== undefined && now() - cached.at < TTL_MS) return phrased(cached.list, options)
    inflight ??= probeAll().finally(() => {
      inflight = undefined
    })
    return phrased(await inflight, options)
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
    if (spec?.update === undefined) return unavailable(engine, textOf(options))
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
      output: updateOutput(command.output, { ok, before, after }, textOf(options)),
    }
  }

  const install = async (engine: string): Promise<UpdateResult> => {
    const spec = known.find((candidate) => candidate.engine === engine)
    if (spec?.install === undefined) return noInstaller(engine, textOf(options))
    const done = await runInstall(spec, { run, log, m: textOf(options) })
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
  deps: { run: EngineCommandRunner; log: Logger; m: Text },
): Promise<UpdateResult> {
  const step = spec.install
  if (step === undefined) return noInstaller(spec.engine, deps.m)
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
    output: installOutput(command.output, ok, deps.m),
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

function noInstaller(engine: string, m: Text): UpdateResult {
  return { ok: false, changed: false, output: m.noInstaller(engine) }
}

function installOutput(output: string, ok: boolean, m: Text): string {
  if (ok) return output === "" ? m.installQuiet : output
  return [output === "" ? m.installSilent : output, m.installMissing].join("\n\n")
}

export function installEngineVersionChannel(_log: Logger, versions: EngineVersionStore, channels: Channels): void {
  // 装与更新只在本机挂：它们在宿主上执行安装命令（见 `remote/exposure.ts`）
  ipcMain.handle("switchback:updateEngine", (_event, engine: string) => versions.update(engine))
  ipcMain.handle("switchback:installEngine", (_event, engine: string) => versions.install(engine))
  channels.handle("switchback:engineVersions", (refresh: unknown) => versions.get(refresh === true))
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

function unavailable(engine: string, m: Text): UpdateResult {
  return { ok: false, changed: false, output: m.noUpdater(engine) }
}

function updateOutput(
  output: string,
  check: { ok: boolean; before: string | undefined; after: string | undefined },
  m: Text,
): string {
  if (check.ok) return output === "" ? m.updateQuiet : output
  return [output === "" ? m.updateSilent : output, m.recheck(check.before ?? "?", check.after ?? "?")].join("\n\n")
}

/**
 * 缓存里存的是码（`note`），往外给的时候才按**这一刻**的界面语言换成那句话（`detail`）。
 * 渲染层拿到的形状和以前一样，切了语言也不必重新探测——那要跑一串子进程、还要联网查最新版。
 */
function phrased(list: readonly EngineVersion[], options: EngineVersionOptions): readonly EngineVersion[] {
  const m = VERSION_NOTE[options.locale?.() ?? DEFAULT_LOCALE]
  return list.map(({ note, ...rest }) => (note === undefined ? rest : { ...rest, detail: m.note[note] }))
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined
}
