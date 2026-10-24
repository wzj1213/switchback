import { join } from "node:path"
import { isWindows, lookupCommand, type ClaudeExecutable } from "@switchback/engine"
import {
  compare,
  grokCheck,
  latestOf,
  versionOf,
  type EngineCommandRunner,
  type NpmGlobalState,
} from "./enginever-command.js"
import { BUILTIN_ENGINE_LABELS } from "../shared/builtin-engines.js"
import type { Locale } from "@switchback/i18n"
import type { VERSION_NOTE } from "./enginever-sources.messages.js"

/** 一行附的那句说明是哪一句。说法在 `enginever-sources.messages.ts`。 */
export type VersionNote = keyof (typeof VERSION_NOTE)[Locale]["note"]

/** 设置页里一家引擎的版本与更新入口。 */
export interface EngineVersion {
  engine: string
  label: string
  installed?: string
  latest?: string
  stale: boolean
  /** 按钮将逐字执行的命令。没有这一项就不画按钮。 */
  update?: string
  /**
   * **这台机器上根本没有这一家。**
   *
   * 上一版这种情况是 `inspect` 返回 `undefined`，于是那一家整行从设置页消失，
   * 只剩一句「没探到这家的安装版本；它可能尚未安装，或不在当前 PATH 中」——
   * 一句正确、但**说不出下一步**的话。而这个仓库自己的规矩是
   * 「报错必须说得出下一步该干什么」。
   */
  missing?: boolean
  /**
   * 装它要跑的那条命令。**只有 Switchback 真的知道来源的那几家才有**。
   *
   * 没有就是没有：grok 与 DSH 各自走自己的安装器，Switchback 手上没有一个
   * 验证过的包名，那就照实说「Switchback 不知道」，**不编一条命令出来**——
   * 编出来的那条一旦是错的，用户会以为是 Switchback 装坏了。
   */
  install?: string
  /** 解释为什么没按钮，或最新版为什么暂时查不到。由 `note` 按当时的界面语言说出来。 */
  detail?: string
  /**
   * `detail` 是哪一句。**探测结果缓存几个小时，存码不存话**：换了界面语言，
   * 下次取的时候照新语言说；往外给之前换成 `detail`（见 `enginever.ts` 的 `phrased`）。
   */
  note?: VersionNote
}

export interface InspectContext {
  run: EngineCommandRunner
  npmGlobal: Promise<NpmGlobalState>
}

export interface UpdateCommand {
  command: string
  args: readonly string[]
  display: string
  /** 原生更新器可能只完成检查、版本不变；仍算命令成功，但不声称发生过更新。 */
  unchangedOk?: boolean
}

export interface EngineSpec {
  engine: string
  label: string
  bin: string
  update?: UpdateCommand
  /** 没装时用它。见 `EngineVersion.install`。 */
  install?: UpdateCommand
  /** 没装、又没有可执行的安装命令时，说清楚该去哪儿装。 */
  where?: VersionNote
  inspect: (context: InspectContext) => Promise<EngineVersion | undefined>
}

/**
 * 没装的那一家长什么样。
 *
 * **它必须留在清单里。** 从清单里消失等于「Switchback 不知道有这一家」，
 * 而事实是 Switchback 知道得很清楚——它只是没装。这两件事在界面上必须分得开。
 */
export function missingOf(spec: EngineSpec): EngineVersion {
  return {
    engine: spec.engine,
    label: spec.label,
    stale: false,
    missing: true,
    ...(spec.install === undefined ? {} : { install: spec.install.display }),
    ...(spec.where === undefined ? {} : { note: spec.where }),
  }
}

/** 五家各走自己暴露的路径：npm 安装、原生更新器、随应用更新，或只报版本。 */
export function specs(claude: ClaudeExecutable): readonly EngineSpec[] {
  return [
    claudeSpec(claude),
    npmSpec("codex", BUILTIN_ENGINE_LABELS.codex, "codex", "@openai/codex"),
    npmSpec("kimi", BUILTIN_ENGINE_LABELS.kimi, "kimi", "@moonshot-ai/kimi-code"),
    grokSpec(),
    dshSpec(),
  ]
}

function claudeSpec(mode: ClaudeExecutable): EngineSpec {
  const update = mode === "system" ? nativeUpdate("claude") : undefined
  const install: UpdateCommand = {
    command: "npm",
    args: ["i", "-g", "@anthropic-ai/claude-code"],
    display: "npm i -g @anthropic-ai/claude-code",
  }
  return {
    engine: "claude",
    label: BUILTIN_ENGINE_LABELS.claude,
    bin: "claude",
    ...(update === undefined ? {} : { update }),
    // 完整版随 Switchback 打包，机器上没有 claude 也照样能跑，所以那一档不给安装入口；
    // 轻量版要 PATH 上有 claude，那一档才需要装
    ...(mode === "system" ? { install } : {}),
    inspect: async ({ run }) => {
      if (mode === "bundled") return bundledClaude()
      const installed = await versionOf("claude", run)
      if (installed === undefined) return undefined
      return {
        engine: "claude",
        label: BUILTIN_ENGINE_LABELS.claude,
        installed,
        stale: false,
        update: "claude update",
        note: "claude-self",
      }
    },
  }
}

function bundledClaude(): EngineVersion {
  return {
    engine: "claude",
    label: BUILTIN_ENGINE_LABELS.claude,
    stale: false,
    note: "claude-bundled",
  }
}

function npmSpec(engine: string, label: string, bin: string, pkg: string): EngineSpec {
  const update: UpdateCommand = {
    command: "npm",
    args: ["i", "-g", `${pkg}@latest`],
    display: `npm i -g ${pkg}@latest`,
  }
  return {
    engine,
    label,
    bin,
    update,
    // 装和更到最新是同一条命令。**不为了好看另写一条**——
    // 两条命令意味着两条路要各自验，而它们本来就是一件事
    install: update,
    inspect: async (context) =>
      inspectNpm({ engine, label, bin, pkg, update: update.display }, context),
  }
}

interface NpmSource {
  engine: string
  label: string
  bin: string
  pkg: string
  update: string
}

async function inspectNpm(
  source: NpmSource,
  context: InspectContext,
): Promise<EngineVersion | undefined> {
  const { engine, label, pkg } = source
  const installed = await versionOf(source.bin, context.run)
  if (installed === undefined) return undefined
  if (!(await isMatchingNpmInstall(source, installed, context))) {
    return otherInstall(engine, label, installed)
  }
  const latest = await latestOf(pkg, context.run)
  const stale = latest !== undefined && compare(installed, latest) < 0
  return {
    engine,
    label,
    installed,
    ...(latest === undefined ? {} : { latest }),
    stale,
    ...(stale ? { update: source.update } : {}),
    ...(latest === undefined ? { note: "npm-latest-unknown" as const } : {}),
  }
}

async function isMatchingNpmInstall(
  source: NpmSource,
  installed: string,
  context: InspectContext,
): Promise<boolean> {
  const global = await context.npmGlobal
  if (global.versions[source.pkg] !== installed || global.prefix === undefined) return false
  const resolved = await commandPath(source.bin, context.run)
  if (resolved === undefined) return false
  const expected = isWindows
    ? join(global.prefix, `${source.bin}.cmd`)
    : join(global.prefix, "bin", source.bin)
  return isWindows ? resolved.toLowerCase() === expected.toLowerCase() : resolved === expected
}

async function commandPath(bin: string, run: EngineCommandRunner): Promise<string | undefined> {
  const lookup = lookupCommand()
  const result = await run(lookup.command, lookup.args(bin), 5000)
  return result.ok ? result.output.split("\n").find((line) => line !== "") : undefined
}

function otherInstall(engine: string, label: string, installed: string): EngineVersion {
  return {
    engine,
    label,
    installed,
    stale: false,
    note: "other-install",
  }
}

function grokSpec(): EngineSpec {
  const update = nativeUpdate("grok")
  return {
    engine: "grok",
    label: BUILTIN_ENGINE_LABELS.grok,
    bin: "grok",
    update,
    // **不给命令**：这台机器上的 grok 装在 `~/.grok/bin`，那是它自己的安装器铺的，
    // Switchback 手上没有一个验证过的包名。编一条出来一旦是错的，用户会以为是 Switchback 装坏了
    where: "grok-where",
    inspect: async ({ run }) => inspectGrok(run, update.display),
  }
}

function dshSpec(): EngineSpec {
  return {
    engine: "dsh",
    label: BUILTIN_ENGINE_LABELS.dsh,
    bin: "dsh",
    where: "dsh-where",
    inspect: async ({ run }) => {
      const installed = await versionOf("dsh", run)
      if (installed === undefined) return undefined
      return {
        engine: "dsh",
        label: BUILTIN_ENGINE_LABELS.dsh,
        installed,
        stale: false,
        note: "dsh-self",
      }
    },
  }
}

async function inspectGrok(
  run: EngineCommandRunner,
  update: string,
): Promise<EngineVersion | undefined> {
  const fallback = await versionOf("grok", run)
  if (fallback === undefined) return undefined
  const checked = await grokCheck(run)
  const installed = checked?.current ?? fallback
  const latest = checked?.latest
  const stale = checked?.available ?? (latest !== undefined && compare(installed, latest) < 0)
  return {
    engine: "grok",
    label: BUILTIN_ENGINE_LABELS.grok,
    installed,
    ...(latest === undefined ? {} : { latest }),
    stale,
    ...(stale ? { update } : {}),
    ...(checked === undefined ? { note: "grok-latest-unknown" as const } : {}),
  }
}

function nativeUpdate(bin: string): UpdateCommand {
  return { command: bin, args: ["update"], display: `${bin} update`, unchangedOk: true }
}
