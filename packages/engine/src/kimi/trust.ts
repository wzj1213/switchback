import type { EngineAxis, Trust } from "@omni/protocol"
import type { KimiStatus } from "./wire.js"

export interface KimiTrust {
  permission_mode: "manual" | "auto" | "yolo"
  plan_mode: boolean
}

/** Kimi 自己公开的三档：Plan / Auto / YOLO，逐一对应 omni 已有的三档。 */
export const KIMI_TRUST: Readonly<Record<Trust, KimiTrust>> = {
  "read-only": { permission_mode: "manual", plan_mode: true },
  "auto-edit": { permission_mode: "auto", plan_mode: false },
  full: { permission_mode: "yolo", plan_mode: false },
}

function axis(axis: string, id: string | undefined, aligned: boolean): EngineAxis | undefined {
  return id === undefined ? undefined : { axis, id, match: aligned ? "aligned" : "diverged" }
}

export function trustAxes(status: KimiStatus, trust: Trust): readonly EngineAxis[] {
  const want = KIMI_TRUST[trust]
  return [
    axis("permission", status.permission, status.permission === want.permission_mode),
    axis("plan", status.plan_mode === undefined ? undefined : String(status.plan_mode), status.plan_mode === want.plan_mode),
  ].filter((entry): entry is EngineAxis => entry !== undefined)
}
