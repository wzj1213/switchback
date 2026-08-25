import type { ForeignFork, ForeignSteer } from "./caps.js"

/** Grok 1.0.5 首方 Agent Mode 文档公开的 mid-turn interject；wire 扩展带前导下划线。 */
export const grokSteer: ForeignSteer = (sessionId, text) => ({
  method: "_x.ai/interject",
  params: { sessionId, text },
})

/**
 * Grok 的完整会话分叉。2026-08-25 对 1.0.5 真机验证：回包用 `newSessionId`，
 * 复制完成后必须另发标准 `session/load`，否则新进程仍未接入分支。
 */
export const grokFork: ForeignFork = {
  request: (sourceSessionId, cwd) => ({
    method: "_x.ai/session/fork",
    params: { sourceSessionId, sourceCwd: cwd, newCwd: cwd, mcpServers: [] },
  }),
  handle: (raw) => {
    if (typeof raw !== "object" || raw === null) return undefined
    const id = (raw as { newSessionId?: unknown }).newSessionId
    return typeof id === "string" && id !== "" ? id : undefined
  },
}
