import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ClaudeExecutable } from "@switchback/engine"

export interface BuildInfo {
  build?: string
  repo?: string
  updateFeed?: string
  claudeExecutable: ClaudeExecutable
}

export function parseBuildInfo(raw: unknown): BuildInfo {
  const switchback =
    typeof raw === "object" && raw !== null
      ? (raw as { switchback?: Record<string, unknown> }).switchback
      : undefined
  return {
    ...(typeof switchback?.build === "string" ? { build: switchback.build } : {}),
    ...(typeof switchback?.repo === "string" ? { repo: switchback.repo } : {}),
    ...(typeof switchback?.updateFeed === "string" ? { updateFeed: switchback.updateFeed } : {}),
    claudeExecutable: switchback?.claudeExecutable === "system" ? "system" : "bundled",
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
