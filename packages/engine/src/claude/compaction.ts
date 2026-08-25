import type { Event, NoticeItem, TurnId } from "@omni/protocol"

const KEY = "claude:context-compaction"

interface RawCompaction {
  subtype?: unknown
  status?: unknown
  compact_result?: unknown
  compact_error?: unknown
  compact_metadata?: unknown
}

interface CompactMetadata {
  trigger?: unknown
  pre_tokens?: unknown
  post_tokens?: unknown
}

interface CompactionContext {
  turnId: TurnId
  at: number
  emit: (event: Event) => void
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function metadataOf(value: unknown): CompactMetadata | undefined {
  return typeof value === "object" && value !== null ? value as CompactMetadata : undefined
}

function completedMessage(raw: RawCompaction): string {
  const metadata = metadataOf(raw.compact_metadata)
  const before = count(metadata?.pre_tokens)
  const after = count(metadata?.post_tokens)
  const label = metadata?.trigger === "auto" ? "上下文已自动压缩" : "上下文已压缩"
  return before === undefined || after === undefined
    ? `${label}。`
    : `${label}：${String(before)} → ${String(after)} tokens。`
}

function failedMessage(raw: RawCompaction): string {
  const detail = typeof raw.compact_error === "string" ? raw.compact_error.trim() : ""
  return detail === "" ? "上下文压缩未完成。" : `上下文压缩未完成：${detail}`
}

function update(
  notices: Map<string, NoticeItem>,
  ctx: CompactionContext,
  message: string,
  level: NoticeItem["level"],
): void {
  const previous = notices.get(KEY)
  const item: NoticeItem = previous === undefined
    ? {
      id: `claude-compaction-${ctx.turnId}`,
      turnId: ctx.turnId,
      at: ctx.at,
      kind: "notice",
      message,
      level,
    }
    : { ...previous, message, level }
  notices.set(KEY, item)
  ctx.emit({ type: previous === undefined ? "item.started" : "item.updated", at: ctx.at, item })
}

/** SDK 的 status / compact_boundary 合成一条不重复的压缩生命周期提示。 */
export function emitCompaction(
  raw: RawCompaction,
  notices: Map<string, NoticeItem>,
  ctx: CompactionContext,
): void {
  if (raw.subtype === "compact_boundary") {
    update(notices, ctx, completedMessage(raw), "info")
    return
  }
  if (raw.subtype !== "status") return
  if (raw.status === "compacting") {
    update(notices, ctx, "正在压缩上下文…", "info")
  } else if (raw.compact_result === "success") {
    update(notices, ctx, "上下文已压缩。", "info")
  } else if (raw.compact_result === "failed") {
    update(notices, ctx, failedMessage(raw), "notice")
  }
}

/** 结构化失败后 CLI 还会补一条 `<synthetic>` assistant；只压掉这份重复回声。 */
export function isFailedCompactionEcho(
  raw: { message?: { model?: unknown } },
  notices: ReadonlyMap<string, NoticeItem>,
): boolean {
  return raw.message?.model === "<synthetic>"
    && notices.get(KEY)?.message.startsWith("上下文压缩未完成") === true
}
