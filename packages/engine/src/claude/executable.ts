import { probeCommand, resolveCommand, type Probe } from "../probe.js"

export type ClaudeExecutable = "bundled" | "system"

type ProbeCommand = (command: string, hint?: string) => Promise<Probe>
type ResolveCommand = (command: string) => Promise<string>

export async function claudePath(
  mode: ClaudeExecutable,
  resolve: ResolveCommand = resolveCommand,
): Promise<string | undefined> {
  return mode === "system" ? resolve("claude") : undefined
}

/** Full builds trust the SDK bundle; thin builds require a working system CLI. */
export async function probeClaude(
  mode: ClaudeExecutable,
  probe: ProbeCommand = probeCommand,
): Promise<Probe> {
  const found = await probe(
    "claude",
    mode === "system" ? "轻量版不内置 Claude，请先安装 Claude Code。" : undefined,
  )
  if (mode === "system" || found.state === "ok") return found
  return {
    state: "unknown",
    detail: "PATH 上没有 `claude`，但完整版会使用 SDK 内置版本；真起不来时再显示引擎原话。",
  }
}
