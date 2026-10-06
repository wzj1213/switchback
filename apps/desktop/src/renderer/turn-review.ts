import type { FileChange } from "@switchback/protocol"
import type { Changes, ChangedFile } from "./changes.js"
import type { ReviewFile } from "../shared/review.js"
import { parseDiff } from "./diff.js"
import { numbered, trimMeta, type NumberedLine } from "./review-lines.js"
import { relPath } from "./tool.js"

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

export function reportBody(change: FileChange): string | undefined {
  if (change.diff === undefined) return "引擎记录了这次编辑，但没有提供补丁内容。"
  if (change.diff.length > 1_500_000 || change.diff.split("\n").length > 10_000) {
    return "这份编辑记录过大，无法在面板中完整显示。"
  }
  if (change.diff === "") return "这次编辑没有文本差异。"
  return undefined
}
