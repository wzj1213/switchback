import type { Event, NoticeItem, TurnId } from "@omni/protocol"
import type { KimiPayload, KimiTranscriptMarker } from "./wire.js"

type ActivationTrigger = "user-slash" | "model-tool" | "nested-skill"

interface Activation {
  id: string
  message: string
  trigger: ActivationTrigger
}

interface ActivationDeps {
  emit: (event: Event) => void
  turnId: () => TurnId | undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function triggerOf(value: unknown): ActivationTrigger | undefined {
  if (value === "user-slash" || value === "model-tool" || value === "nested-skill") return value
  return undefined
}

function activationRecord(raw: unknown): Record<string, unknown> | undefined {
  const root = record(raw)
  if (root === undefined) return undefined
  const origin = record(root["origin"])
  if (origin !== undefined) return origin
  const payload = record(root["payload"])
  return payload ?? root
}

export function kimiActivation(raw: unknown): Activation | undefined {
  const value = activationRecord(raw)
  if (value === undefined) return undefined
  const id = nonEmpty(value["activationId"])
  const trigger = triggerOf(value["trigger"])
  if (id === undefined || trigger === undefined) return undefined
  const pluginId = nonEmpty(value["pluginId"])
  const commandName = nonEmpty(value["commandName"])
  if (pluginId !== undefined && commandName !== undefined) {
    return { id, trigger, message: `/${pluginId}:${commandName}` }
  }
  const skillName = nonEmpty(value["skillName"])
  return skillName === undefined
    ? undefined
    : { id, trigger, message: `Activated skill: ${skillName}` }
}

export function kimiActivationItem(activation: Activation, turnId: TurnId, at: number): NoticeItem {
  return {
    id: `kimi-activation-${activation.id}`,
    turnId,
    at,
    kind: "notice",
    message: activation.message,
    level: "info",
  }
}

export function kimiTranscriptActivation(marker: KimiTranscriptMarker): Activation | undefined {
  return marker.marker === "skill" ? kimiActivation(marker.payload) : undefined
}

export class KimiActivations {
  private readonly seen = new Set<string>()

  constructor(private readonly deps: ActivationDeps) {}

  handle(payload: KimiPayload, at: number): boolean {
    if (payload.type !== "skill.activated" && payload.type !== "plugin_command.activated")
      return false
    const activation = kimiActivation(payload)
    if (activation === undefined || this.seen.has(activation.id)) return true
    this.seen.add(activation.id)
    const turnId = this.deps.turnId()
    if (turnId !== undefined) {
      this.deps.emit({ type: "item.started", at, item: kimiActivationItem(activation, turnId, at) })
    }
    return true
  }
}
