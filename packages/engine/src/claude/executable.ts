import { probeCommand, resolveCommand, type Probe } from "../probe.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_EXECUTABLE } from "./executable.messages.js"

export type ClaudeExecutable = "bundled" | "system"

type ProbeCommand = (command: string, hint?: string, locale?: Locale) => Promise<Probe>
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
  locale: Locale = DEFAULT_LOCALE,
): Promise<Probe> {
  const m = CLAUDE_EXECUTABLE[locale]
  const found = await probe("claude", mode === "system" ? m.thin : undefined, locale)
  if (mode === "system" || found.state === "ok") return found
  return { state: "unknown", detail: m.bundled }
}
