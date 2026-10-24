import type { Event, ItemId, ThreadId, TurnId } from "@switchback/protocol"
import type { WireWarning } from "./wire.js"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CODEX_WARNINGS } from "./warnings.messages.js"

interface WarningContext {
  threadId: ThreadId
  turnId: () => TurnId | undefined
  materialized: Set<ItemId>
  emit: (event: Event) => void
  now: () => number
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

function locationOf(params: WireWarning): string | undefined {
  if (typeof params.path !== "string" || params.path === "") return undefined
  const line = params.range?.start?.line
  const column = params.range?.start?.column
  if (!Number.isInteger(line) || !Number.isInteger(column) || line === undefined || column === undefined) {
    return params.path
  }
  return `${params.path}:${String(line)}:${String(column)}`
}

function textOf(params: WireWarning, m: (typeof CODEX_WARNINGS)[Locale]): string | undefined {
  const head = typeof params.message === "string" ? params.message : params.summary
  if (typeof head !== "string" || head === "") return undefined
  const detail = typeof params.details === "string" && params.details !== "" ? params.details : undefined
  const location = locationOf(params)
  return [head, detail, location === undefined ? undefined : m.location(location)]
    .filter((part): part is string => part !== undefined)
    .join("\n")
}

function nextId(ctx: WarningContext, turnId: TurnId, at: number): ItemId {
  const base = `codex-warning-${turnId}-${String(at)}`
  let id = base
  let suffix = 1
  while (ctx.materialized.has(id)) {
    id = `${base}-${String(suffix)}`
    suffix += 1
  }
  ctx.materialized.add(id)
  return id
}

/** Codex 明确交给客户端显示的 warning；有活跃轮次就进原位，否则落会话横幅。 */
export function emitCodexWarning(ctx: WarningContext, params: WireWarning): void {
  const message = textOf(params, CODEX_WARNINGS[localeOf(ctx)])
  if (message === undefined) return
  const at = ctx.now()
  const turnId = ctx.turnId()
  if (turnId === undefined) {
    ctx.emit({
      type: "engine.status",
      at,
      threadId: ctx.threadId,
      status: "degraded",
      detail: message,
    })
    return
  }
  ctx.emit({
    type: "item.started",
    at,
    item: { id: nextId(ctx, turnId, at), turnId, at, kind: "notice", message, level: "warning" },
  })
}
