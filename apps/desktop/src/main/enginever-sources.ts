import { join } from "node:path"
import { isWindows, lookupCommand, type ClaudeExecutable } from "@omni/engine"
import {
  compare,
  grokCheck,
  latestOf,
  versionOf,
  type EngineCommandRunner,
  type NpmGlobalState,
} from "./enginever-command.js"

/** 设置页里一家引擎的版本与更新入口。 */
export interface EngineVersion {
  engine: string
  label: string
  installed?: string
  latest?: string
  stale: boolean
  /** 按钮将逐字执行的命令。没有这一项就不画按钮。 */
  update?: string
  /** 解释为什么没按钮，或最新版为什么暂时查不到。 */
  detail?: string
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
  inspect: (context: InspectContext) => Promise<EngineVersion | undefined>
}

/** 四家各走自己暴露的更新路径：npm 安装、原生更新器或随应用更新。 */
export function specs(claude: ClaudeExecutable): readonly EngineSpec[] {
  return [
    claudeSpec(claude),
    npmSpec("codex", "Codex", "codex", "@openai/codex"),
    npmSpec("kimi", "Kimi Code", "kimi", "@moonshot-ai/kimi-code"),
    grokSpec(),
  ]
}

function claudeSpec(mode: ClaudeExecutable): EngineSpec {
  const update = mode === "system" ? nativeUpdate("claude") : undefined
  return {
    engine: "claude",
    label: "Claude Code",
    bin: "claude",
    ...(update === undefined ? {} : { update }),
    inspect: async ({ run }) => {
      if (mode === "bundled") return bundledClaude()
      const installed = await versionOf("claude", run)
      if (installed === undefined) return undefined
      return {
        engine: "claude",
        label: "Claude Code",
        installed,
        stale: false,
        update: "claude update",
        detail: "由 Claude 自己检查并安装新版",
      }
    },
  }
}

function bundledClaude(): EngineVersion {
  return {
    engine: "claude",
    label: "Claude Code",
    stale: false,
    detail: "完整版使用随 omni 打包的 Claude；更新 omni 才会换掉它",
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
    ...(latest === undefined ? { detail: "暂时没查到 npm 上的最新版" } : {}),
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
    detail: "当前不是 omni 验过的 npm 全局安装；为免装出第二份，请用原安装来源更新",
  }
}

function grokSpec(): EngineSpec {
  const update = nativeUpdate("grok")
  return {
    engine: "grok",
    label: "Grok",
    bin: "grok",
    update,
    inspect: async ({ run }) => inspectGrok(run, update.display),
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
    label: "Grok",
    installed,
    ...(latest === undefined ? {} : { latest }),
    stale,
    ...(stale ? { update } : {}),
    ...(checked === undefined ? { detail: "暂时没从 Grok 更新器查到最新版" } : {}),
  }
}

function nativeUpdate(bin: string): UpdateCommand {
  return { command: bin, args: ["update"], display: `${bin} update`, unchangedOk: true }
}
