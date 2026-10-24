import type { Event, ThreadId } from "@switchback/protocol"
import { sanitize } from "./permission.js"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CLAUDE_ELICITATION_DONE } from "./elicitation-complete.messages.js"

interface RawElicitationComplete {
  mcp_server_name?: unknown
  elicitation_id?: unknown
}

interface ElicitationCompleteContext {
  threadId: ThreadId
  at: number
  emit: (event: Event) => void
  locale?: () => Locale
}

const TIMEOUT_MS = 8000

function display(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const clean = sanitize(value)
  return clean === "" ? undefined : clean
}

/** Claude 已先核过原生 pending id；宿主只显示它转发的完成确认。 */
export function emitElicitationComplete(
  msg: RawElicitationComplete,
  ctx: ElicitationCompleteContext,
): void {
  const server = display(msg.mcp_server_name)
  const id = display(msg.elicitation_id)
  if (server === undefined || id === undefined) return
  ctx.emit({
    type: "engine.notification",
    at: ctx.at,
    threadId: ctx.threadId,
    engine: "claude",
    key: `elicitation-complete:${server}:${id}`,
    message: CLAUDE_ELICITATION_DONE[localeOf(ctx)].done(server, id),
    priority: "low",
    timeoutMs: TIMEOUT_MS,
  })
}
