import type { Event, ItemId, NoticeItem, TurnId } from "@switchback/protocol"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CLAUDE_MEMORY } from "./memory.messages.js"

interface MemoryContext {
  turnId: TurnId
  at: number
  nextId: () => ItemId
  emit: (event: Event) => void
  locale?: () => Locale
}

interface RawMemory {
  path?: unknown
  scope?: unknown
}


/** 文件名允许换行，但 transcript 里不能让控制字符伪造下一条状态。 */
function displayPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return undefined
  const safe = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "�").trim()
  return safe === "" ? undefined : safe
}

function memoryRows(value: unknown, m: (typeof CLAUDE_MEMORY)[Locale]): readonly string[] {
  const scopes: Readonly<Record<string, string>> = m.scope
  if (!Array.isArray(value)) return []
  const rows: string[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 5)) {
    if (typeof raw !== "object" || raw === null) continue
    const memory = raw as RawMemory
    const path = displayPath(memory.path)
    const scope = typeof memory.scope === "string" && Object.hasOwn(scopes, memory.scope) ? scopes[memory.scope] : undefined
    if (path === undefined || scope === undefined || seen.has(path)) continue
    seen.add(path)
    rows.push(`- [${scope}] ${path}`)
  }
  return rows
}

/**
 * SDK 明确要求 renderer 显示的记忆召回事件。
 *
 * 正文已经进入 Claude 当前轮，而且一次最多可达约 20 KiB；这里保留来源和完整路径，
 * 不再把同一份上下文复制进 transcript。用户仍能分清哪一层记忆影响了回答。
 */
export function emitMemoryRecall(raw: unknown, ctx: MemoryContext): void {
  if (typeof raw !== "object" || raw === null) return
  const message = raw as { subtype?: unknown; mode?: unknown; memories?: unknown }
  if (message.subtype !== "memory_recall") return
  if (message.mode !== "select" && message.mode !== "synthesize") return
  const m = CLAUDE_MEMORY[localeOf(ctx)]
  const rows = memoryRows(message.memories, m)
  if (rows.length === 0) return
  const item: NoticeItem = {
    id: ctx.nextId(),
    turnId: ctx.turnId,
    at: ctx.at,
    kind: "notice",
    message: m.recalled(rows),
    level: "info",
  }
  ctx.emit({ type: "item.started", at: ctx.at, item })
}
