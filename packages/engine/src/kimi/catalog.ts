import type { EngineAccount, EngineThread, ModelOption, RateLimits, SlashCommand } from "@omni/protocol"
import type { KimiModel, KimiSessionRow, KimiSkill } from "./wire.js"

const HISTORY_MAX = 40
const TITLE_MAX = 60

function atOf(raw: string | number | undefined): number {
  if (typeof raw === "number") return raw
  if (raw === undefined) return 0
  const at = new Date(raw).getTime()
  return Number.isNaN(at) ? 0 : at
}

function titleOf(row: KimiSessionRow): string {
  const title = row.title.trim() || (row.last_prompt ?? "").split("\n").find((line) => line.trim() !== "")?.trim() || "（没有标题）"
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX)}…` : title
}

export function toHistory(rows: readonly KimiSessionRow[]): readonly EngineThread[] {
  const out: EngineThread[] = []
  for (const row of rows) {
    if (row.id === "" || row.metadata.cwd === "") continue
    out.push({ handle: row.id, title: titleOf(row), cwd: row.metadata.cwd, updatedAt: atOf(row.updated_at) })
    if (out.length >= HISTORY_MAX) break
  }
  return out
}

export function toModels(rows: readonly KimiModel[], defaultModel: string | undefined): readonly ModelOption[] {
  return rows.map((row) => ({
    id: row.model,
    label: row.display_name ?? row.model,
    ...(row.support_efforts === undefined || row.support_efforts.length === 0 ? {} : { efforts: row.support_efforts }),
    ...(row.default_effort === undefined ? {} : { defaultEffort: row.default_effort }),
    ...(row.model === defaultModel ? { isDefault: true } : {}),
  }))
}

function skillScope(source: string | undefined): SlashCommand["scope"] {
  if (source === "user") return "user"
  if (source === "workspace" || source === "project") return "project"
  if (source === "builtin" || source === "system") return "system"
  return undefined
}

export function toCommands(rows: readonly KimiSkill[]): readonly SlashCommand[] {
  return rows.map((row) => ({
    name: row.name,
    description: row.description ?? "",
    source: "engine" as const,
    ...(skillScope(row.source) === undefined ? {} : { scope: skillScope(row.source) }),
  }))
}

interface UserInfoResponse {
  kind?: string
  userInfo?: { nickname?: string; userLevelName?: string }
}

export function toAccount(raw: UserInfoResponse): EngineAccount | undefined {
  const label = raw.kind === "ok" ? raw.userInfo?.nickname?.trim() : undefined
  if (label === undefined || label === "") return undefined
  const plan = raw.userInfo?.userLevelName?.trim()
  return { label, ...(plan === undefined || plan === "" ? {} : { plan }) }
}

interface UsageWindow {
  window?: { duration?: number; unit?: string }
  used?: number
  limit?: number
  reset_at?: string
}

const WINDOW_MINUTES: Readonly<Record<string, number>> = {
  minute: 1,
  hour: 60,
  day: 1440,
  week: 10_080,
}

export interface OAuthUsage {
  kind?: string
  summary?: UsageWindow
  limits?: readonly UsageWindow[]
}

function rateWindow(raw: UsageWindow | undefined): RateLimits["primary"] {
  if (raw?.used === undefined || raw.limit === undefined || raw.limit <= 0) return undefined
  const minutes = (raw.window?.duration ?? 0) * (WINDOW_MINUTES[raw.window?.unit ?? ""] ?? 0)
  return {
    usedPercent: (raw.used / raw.limit) * 100,
    ...(minutes <= 0 ? {} : { windowDurationMins: minutes }),
    ...(raw.reset_at === undefined ? {} : { resetsAt: raw.reset_at }),
  }
}

export function toLimits(raw: OAuthUsage): RateLimits | undefined {
  if (raw.kind !== "ok") return undefined
  const primary = rateWindow(raw.summary)
  const secondary = rateWindow(raw.limits?.[0])
  if (primary === undefined && secondary === undefined) return undefined
  return { ...(primary === undefined ? {} : { primary }), ...(secondary === undefined ? {} : { secondary }) }
}
