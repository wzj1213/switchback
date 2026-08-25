import type { Event, ItemId, NoticeItem, TurnId } from "@omni/protocol"

interface MemoryContext {
  turnId: TurnId
  at: number
  nextId: () => ItemId
  emit: (event: Event) => void
}

interface RawMemory {
  path?: unknown
  scope?: unknown
}

const SCOPE_LABELS: Readonly<Record<string, string>> = {
  personal: "个人",
  team: "团队",
  organization: "组织",
}

/** 文件名允许换行，但 transcript 里不能让控制字符伪造下一条状态。 */
function displayPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return undefined
  const safe = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, "�").trim()
  return safe === "" ? undefined : safe
}

function memoryRows(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const rows: string[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 5)) {
    if (typeof raw !== "object" || raw === null) continue
    const memory = raw as RawMemory
    const path = displayPath(memory.path)
    const scope = typeof memory.scope === "string" ? SCOPE_LABELS[memory.scope] : undefined
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
  const rows = memoryRows(message.memories)
  if (rows.length === 0) return
  const item: NoticeItem = {
    id: ctx.nextId(),
    turnId: ctx.turnId,
    at: ctx.at,
    kind: "notice",
    message: `Claude 已从记忆中召回 ${String(rows.length)} 条：\n${rows.join("\n")}`,
    level: "info",
  }
  ctx.emit({ type: "item.started", at: ctx.at, item })
}
