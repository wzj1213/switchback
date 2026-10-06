import type { AgentMessageItem, TurnId } from "@switchback/protocol"
import type { KimiPayload } from "./wire.js"

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/** 与 Kimi 0.38.0 自己的 TUI `formatHookResultMarkdown` 保持同一展示文本。 */
export function kimiHookResult(
  payload: KimiPayload,
  turnId: TurnId,
  at: number,
  seq: number,
): AgentMessageItem | undefined {
  const hookEvent = nonEmpty(payload["hookEvent"])
  if (hookEvent === undefined || typeof payload["content"] !== "string") return undefined
  const title = `${hookEvent} hook${payload["blocked"] === true ? " blocked" : ""}`
  const content = payload["content"].trim()
  const body = content === "" ? "(empty)" : content
  return {
    id: `kimi-hook-${turnId}-${String(seq)}`,
    turnId,
    at,
    kind: "agent_message",
    text: `*${title}*\n\n${body}`,
    complete: true,
  }
}
