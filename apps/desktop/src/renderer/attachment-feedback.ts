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
  compact?: boolean
}

export interface AttachmentSummary {
  images: number
  references: number
  failed: number
  outside: number
  duplicates: number
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
  const images = enabled ? review.accepted : 0
  const references = review.total - images
  if (review.total === 0) return { tone: "ready", text: "松手添加文件" }
  if (images > 0 && references > 0) {
    return { tone: "ready", text: `松手添加 ${String(images)} 张图片并引用 ${String(references)} 个文件` }
  }
  if (images > 0) return { tone: "ready", text: `松手添加 ${String(images)} 张图片` }
  return { tone: "ready", text: `松手引用 ${String(references)} 个文件` }
}

export function failedDropHint(notice: { text: string; tone: "info" | "warn" }): DropHint {
  return {
    text: notice.text,
    tone: notice.tone === "warn" ? "blocked" : "ready",
    compact: true,
  }
}

export function dropNotice(summary: {
  images: number
  references: number
  failed: number
  outside: number
  duplicates?: number
}): string | undefined {
  const { images, references, failed, outside, duplicates = 0 } = summary
  let text = images > 0 && references > 0
    ? `已添加 ${String(images)} 张图片，并引用 ${String(references)} 个文件`
    : images > 0 ? `已添加 ${String(images)} 张图片`
      : references > 0 ? `已引用 ${String(references)} 个文件` : ""
  if (failed > 0) {
    text += text === ""
      ? `未添加：${String(failed)} 个文件未能读取`
      : `；另有 ${String(failed)} 个文件未能读取`
  }
  if (duplicates > 0) {
    text += text === ""
      ? `没有重复添加：${String(duplicates)} 个文件已经在待发送内容中`
      : `；另有 ${String(duplicates)} 个文件已经在待发送内容中，没有重复添加`
  }
  if (outside > 0) {
    text += `。其中 ${String(outside)} 个在当前工作区外，已保留绝对路径；能否读取由引擎权限决定`
  }
  return text === "" ? undefined : `${text}。`
}
