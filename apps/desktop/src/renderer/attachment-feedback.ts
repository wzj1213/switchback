import { imageExtension, MAX_IMAGE_BYTES } from "../shared/attachments.js"

export interface AttachmentReview {
  total: number
  accepted: number
  empty: number
  oversized: number
  unsupported: number
}

export interface DropHint {
  tone: "ready" | "blocked"
  text: string
}

interface FileLike {
  type: string
  size: number
}
interface ItemLike { kind: string }

function issue(file: FileLike): keyof Omit<AttachmentReview, "total"> {
  if (imageExtension(file.type) === undefined) return "unsupported"
  if (file.size <= 0) return "empty"
  if (file.size > MAX_IMAGE_BYTES) return "oversized"
  return "accepted"
}

export function reviewAttachments(files: readonly FileLike[]): AttachmentReview {
  const review: AttachmentReview = { total: files.length, accepted: 0, empty: 0, oversized: 0, unsupported: 0 }
  for (const file of files) review[issue(file)] += 1
  return review
}

export function hasFileItems(items: ArrayLike<ItemLike> | null): boolean {
  return items !== null && Array.from(items).some((item) => item.kind === "file")
}

export function hoverHint(review: AttachmentReview, enabled: boolean): DropHint {
  if (review.total > 0 && review.accepted === 0) {
    if (review.unsupported > 0) {
      return { tone: "blocked", text: "这里只能添加图片；工作区文件请用 @ 引用" }
    }
    if (review.oversized > 0) return { tone: "blocked", text: "单张图片不能超过 12 MB" }
    if (review.empty > 0) return { tone: "blocked", text: "空图片不能添加" }
  }
  if (!enabled) return { tone: "blocked", text: "当前引擎或模型不支持图片附件" }
  if (review.total === 0) return { tone: "ready", text: "松手添加图片" }
  if (review.accepted === review.total) {
    return { tone: "ready", text: `松手添加 ${String(review.accepted)} 张图片` }
  }
  if (review.accepted > 0) {
    return { tone: "ready", text: `可添加 ${String(review.accepted)} 张；其余文件不会添加` }
  }
  return { tone: "blocked", text: "图片未能添加" }
}

export function dropNotice(
  review: AttachmentReview,
  enabled: boolean,
  added: number,
  failed: number,
): string | undefined {
  if (review.total > 0 && review.accepted === 0) {
    if (review.unsupported > 0) return "未添加：这里只接收图片；工作区文件请用 @ 引用。"
    if (review.oversized > 0) return "未添加：单张图片不能超过 12 MB。"
    if (review.empty > 0) return "未添加：图片是空文件。"
  }
  if (!enabled) return "当前引擎或模型不支持图片附件。"
  const rejected = review.total - review.accepted + failed
  if (rejected === 0) return undefined
  if (added > 0) return `已添加 ${String(added)} 张；另有 ${String(rejected)} 个文件未添加。`
  return "未添加：读取文件路径失败。"
}
