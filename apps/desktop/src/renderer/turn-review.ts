import type { FileChange } from "@switchback/protocol"
import type { Changes, ChangedFile } from "./changes.js"
import type { ReviewFile } from "../shared/review.js"
import { parseDiff } from "./diff.js"
import { numbered, trimMeta, type NumberedLine } from "./review-lines.js"
import { relPath } from "./tool.js"
import type { Locale } from "@switchback/i18n"
import { TURN_REVIEW } from "./turn-review.messages.js"

export interface TurnReviewTarget {
  threadId: string
  cwd: string
  turnId: string
  edits: Changes
  path?: string
  at?: number
}

const EVENT = "switchback:review-turn"

export function requestTurnReview(target: TurnReviewTarget): void {
  window.dispatchEvent(new CustomEvent<TurnReviewTarget>(EVENT, { detail: target }))
}

export function onTurnReviewRequest(pick: (target: TurnReviewTarget) => void): () => void {
  const receive = (event: Event): void => {
    const target = (event as CustomEvent<TurnReviewTarget | undefined>).detail
    if (target !== undefined && target.threadId !== "" && target.edits.files > 0) pick(target)
  }
  window.addEventListener(EVENT, receive)
  return () => { window.removeEventListener(EVENT, receive) }
}

export function reportedReviewFile(file: ChangedFile, cwd: string): ReviewFile {
  return { path: file.path, rel: relPath(file.path, cwd), kind: file.last.kind,
    added: file.added, removed: file.removed }
}

/** 新建/删除是文件原文；修改是补丁。不能拿今天的 Git 差异替换历史记录。 */
export function reportedLines(change: FileChange): readonly NumberedLine[] {
  const lines = parseDiff(change.diff ?? "", change.kind)
  if (change.kind === "update") return trimMeta(numbered(lines))
  return lines.map((line, index) => ({ ...line,
    ...(change.kind === "add" ? { new: index + 1 } : { old: index + 1 }),
  }))
}

export function reportBody(change: FileChange, locale: Locale): string | undefined {
  const m = TURN_REVIEW[locale]
  if (change.diff === undefined) return m.noPatch
  if (change.diff.length > 1_500_000 || change.diff.split("\n").length > 10_000) {
    return m.tooLarge
  }
  if (change.diff === "") return m.empty
  return undefined
}
