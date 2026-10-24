import type { Event, NoticeItem, TurnId } from "@switchback/protocol"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CLAUDE_COMPACTION } from "./compaction.messages.js"

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
  locale?: () => Locale
}

type Text = (typeof CLAUDE_COMPACTION)[Locale]

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function metadataOf(value: unknown): CompactMetadata | undefined {
  return typeof value === "object" && value !== null ? value as CompactMetadata : undefined
}

function completedMessage(raw: RawCompaction, m: Text): string {
  const metadata = metadataOf(raw.compact_metadata)
  return m.compacted(metadata?.trigger === "auto", count(metadata?.pre_tokens), count(metadata?.post_tokens))
}

function failedMessage(raw: RawCompaction, m: Text): string {
  return m.failed(typeof raw.compact_error === "string" ? raw.compact_error.trim() : "")
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
  const m = CLAUDE_COMPACTION[localeOf(ctx)]
  if (raw.subtype === "compact_boundary") {
    update(notices, ctx, completedMessage(raw, m), "info")
    return
  }
  if (raw.subtype !== "status") return
  if (raw.status === "compacting") {
    update(notices, ctx, m.compacting, "info")
  } else if (raw.compact_result === "success") {
    update(notices, ctx, m.done, "info")
  } else if (raw.compact_result === "failed") {
    update(notices, ctx, failedMessage(raw, m), "notice")
  }
}

/** 结构化失败后 CLI 还会补一条 `<synthetic>` assistant；只压掉这份重复回声。 */
export function isFailedCompactionEcho(
  raw: { message?: { model?: unknown } },
  notices: ReadonlyMap<string, NoticeItem>,
): boolean {
  return raw.message?.model === "<synthetic>"
    // 压缩失败是这一条唯一落 `notice` 级的情况（见 `emitCompaction`）。认级别不认文字：文字随界面语言变
    && notices.get(KEY)?.level === "notice"
}
