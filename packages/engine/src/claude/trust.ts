import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk"
import type { EngineAxis, Trust } from "@switchback/protocol"

/** Claude Code 自己公开的 Plan / Auto / Bypass 三档。 */
export const CLAUDE_TRUST: Readonly<Record<Trust, PermissionMode>> = {
  "read-only": "plan",
  "auto-edit": "auto",
  full: "bypassPermissions",
}

type PermissionOptions = Pick<Options, "permissionMode" | "allowDangerouslySkipPermissions">

/** 开场参数。Bypass 必须由 SDK 的显式安全开关共同授权。 */
export function permissionOptions(trust: Trust): PermissionOptions {
  const permissionMode = CLAUDE_TRUST[trust]
  return trust === "full"
    ? { permissionMode, allowDangerouslySkipPermissions: true }
    : { permissionMode }
}

/** 没带 bypass 启动授权的进程，运行中不能直接切进 Full Access。 */
export function needsPermissionRestart(bypassEnabled: boolean, trust: Trust): boolean {
  return trust === "full" && !bypassEnabled
}

/** 引擎回报的原生 mode 与用户所选档位逐项对齐。 */
export function modeAxis(mode: string, trust: Trust): EngineAxis {
  return {
    axis: "permission",
    id: mode,
    match: mode === CLAUDE_TRUST[trust] ? "aligned" : "diverged",
  }
}
