import { execFile } from "node:child_process"

export interface EngineCommandResult {
  ok: boolean
  output: string
}

export type EngineCommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<EngineCommandResult>

export interface GrokUpdateCheck {
  current?: string
  latest?: string
  available?: boolean
}

export interface NpmGlobalState {
  versions: Readonly<Record<string, string>>
  prefix?: string
}

const CHECK_MS = 12_000

export async function versionOf(
  bin: string,
  run: EngineCommandRunner,
): Promise<string | undefined> {
  const result = await run(bin, ["--version"], 5000)
  return semver(result.output)
}

export async function latestOf(pkg: string, run: EngineCommandRunner): Promise<string | undefined> {
  const result = await run("npm", ["view", pkg, "version"], CHECK_MS)
  return result.ok ? semver(result.output) : undefined
}

export async function npmGlobalState(run: EngineCommandRunner): Promise<NpmGlobalState> {
  const [listed, prefixed] = await Promise.all([
    run("npm", ["ls", "-g", "--depth=0", "--json"], CHECK_MS),
    run("npm", ["prefix", "-g"], CHECK_MS),
  ])
  const versions = listed.ok ? parseGlobalVersions(listed.output) : {}
  const prefix = prefixed.ok && prefixed.output !== "" ? prefixed.output.split("\n")[0] : undefined
  return { versions, ...(prefix === undefined ? {} : { prefix }) }
}

function parseGlobalVersions(output: string): Readonly<Record<string, string>> {
  try {
    const raw = JSON.parse(output) as {
      dependencies?: Record<string, { version?: unknown }>
    }
    return Object.fromEntries(
      Object.entries(raw.dependencies ?? {}).flatMap(([name, value]) =>
        typeof value.version === "string" ? [[name, value.version]] : [],
      ),
    )
  } catch {
    return {}
  }
}

export async function grokCheck(run: EngineCommandRunner): Promise<GrokUpdateCheck | undefined> {
  const result = await run("grok", ["update", "--check", "--json"], CHECK_MS)
  if (!result.ok) return undefined
  try {
    const raw = JSON.parse(result.output) as Record<string, unknown>
    if (typeof raw["error"] === "string" && raw["error"] !== "") return undefined
    const current = semver(raw["currentVersion"])
    const latest = semver(raw["latestVersion"])
    return {
      ...(current === undefined ? {} : { current }),
      ...(latest === undefined ? {} : { latest }),
      ...(typeof raw["updateAvailable"] === "boolean" ? { available: raw["updateAvailable"] } : {}),
    }
  } catch {
    return undefined
  }
}

function semver(value: unknown): string | undefined {
  return typeof value === "string"
    ? /(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)/.exec(value)?.[1]
    : undefined
}

export function compare(a: string, b: string): number {
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (left.pre === undefined) return right.pre === undefined ? 0 : 1
  if (right.pre === undefined) return -1
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const difference = identifierOrder(left.pre[index], right.pre[index])
    if (difference !== 0) return difference
  }
  return 0
}

function parts(value: string): { core: readonly number[]; pre?: readonly string[] } {
  const cut = value.indexOf("-")
  const core = cut === -1 ? value : value.slice(0, cut)
  const pre = cut === -1 ? undefined : value.slice(cut + 1).split(".")
  return {
    core: core.split(".").map(Number),
    ...(pre === undefined ? {} : { pre }),
  }
}

function identifierOrder(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : -1
  if (right === undefined) return 1
  const a = /^\d+$/.test(left) ? Number(left) : undefined
  const b = /^\d+$/.test(right) ? Number(right) : undefined
  if (a !== undefined && b !== undefined) return a - b
  if (a !== undefined) return -1
  if (b !== undefined) return 1
  return left.localeCompare(right)
}

export function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<EngineCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        const output = [stdout.trim(), stderr.trim(), error?.message ?? ""]
          .filter((line) => line !== "")
          .join("\n")
        resolve({ ok: error === null, output })
      },
    )
  })
}
