import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { ipcMain } from "electron"
import { isDshProfileName } from "../shared/settings.js"
import { homeOf } from "./envengines.js"

export interface DshDependency {
  name: string
  version: string
}

export interface DshProfile {
  name: string
  dir: string
  manifestPath: string
  patchPath: string
  patchExists: boolean
  valid: boolean
  bundles: readonly string[]
  dependencies: readonly DshDependency[]
  error?: string
}

export interface DshProfileCatalog {
  home: string
  profilesDir: string
  profiles: readonly DshProfile[]
}

interface Manifest {
  dependencies?: unknown
  dsh?: { profile?: { bundles?: unknown } }
}

function strings(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : []
}

function dependenciesOf(raw: unknown): readonly DshDependency[] {
  if (typeof raw !== "object" || raw === null) return []
  return Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, version]) => ({ name, version }))
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isFile(), () => false)
}

async function inspectProfile(profilesDir: string, name: string): Promise<DshProfile> {
  const dir = join(profilesDir, name)
  const manifestPath = join(dir, "package.json")
  const patchPath = join(dir, "cordis.patch.yml")
  const base = {
    name,
    dir,
    manifestPath,
    patchPath,
    patchExists: await exists(patchPath),
    valid: isDshProfileName(name),
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
    return {
      ...base,
      bundles: strings(manifest.dsh?.profile?.bundles),
      dependencies: dependenciesOf(manifest.dependencies),
    }
  } catch (error) {
    return {
      ...base,
      valid: false,
      bundles: [],
      dependencies: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 只读 profile manifest 与 patch 是否存在；不读取凭证、settings 或合成配置。 */
export async function readDshProfiles(home = homeOf("DSH_HOME", ".dsh")): Promise<DshProfileCatalog> {
  const profilesDir = join(home, "profiles")
  const entries = await readdir(profilesDir, { withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  return { home, profilesDir, profiles: await Promise.all(names.map((name) => inspectProfile(profilesDir, name))) }
}

export function installDshProfileChannel(): void {
  ipcMain.handle("omni:dshProfiles", () => readDshProfiles())
}
