import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ClaudeExecutable } from "@omni/engine"

export interface BuildInfo {
  build?: string
  repo?: string
  updateFeed?: string
  claudeExecutable: ClaudeExecutable
}

export function parseBuildInfo(raw: unknown): BuildInfo {
  const omni =
    typeof raw === "object" && raw !== null
      ? (raw as { omni?: Record<string, unknown> }).omni
      : undefined
  return {
    ...(typeof omni?.build === "string" ? { build: omni.build } : {}),
    ...(typeof omni?.repo === "string" ? { repo: omni.repo } : {}),
    ...(typeof omni?.updateFeed === "string" ? { updateFeed: omni.updateFeed } : {}),
    claudeExecutable: omni?.claudeExecutable === "system" ? "system" : "bundled",
  }
}

export function readBuildInfo(appPath: string): BuildInfo {
  try {
    return parseBuildInfo(
      JSON.parse(readFileSync(join(appPath, "package.json"), "utf8")) as unknown,
    )
  } catch {
    return { claudeExecutable: "bundled" }
  }
}
