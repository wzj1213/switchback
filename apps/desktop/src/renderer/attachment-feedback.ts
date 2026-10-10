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
  /** 粘贴进来的图超过上限：读得到，只是太大。和「读不出来」分开说。 */
  oversized?: number
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

/**
 * 这一次粘贴按文件收，还是按文字收。
 *
 * 从 Excel、Word、Numbers、网页复制一段内容，剪贴板里除了正文和富文本（HTML / RTF），
 * 还常带一张**把这段内容画出来的图**。只要有文件项就按文件收的话，收下的是那张图，字全丢了。
 * 所以：有正文、又带着富文本时按文字收。Finder 复制文件（只有文件名文本、没有富文本）、
 * 单独复制的一张图（没有正文）照旧按文件收。
 */
export function pastesFiles(types: readonly string[], items: ArrayLike<ItemLike> | null, text: string): boolean {
  if (!hasFileItems(items)) return false
  const rich = types.includes("text/html") || types.includes("text/rtf")
  return !rich || text.trim() === ""
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

function addedText(images: number, references: number): string {
  if (images > 0 && references > 0) return `已添加 ${String(images)} 张图片，并引用 ${String(references)} 个文件`
  if (images > 0) return `已添加 ${String(images)} 张图片`
  return references > 0 ? `已引用 ${String(references)} 个文件` : ""
}

/** 接一句：前面什么都没说就用打头的说法，否则用「；另有……」接上。 */
function clause(text: string, lead: string, follow: string): string {
  return text === "" ? lead : `${text}；${follow}`
}

export function dropNotice(summary: {
  images: number
  references: number
  failed: number
  outside: number
  duplicates?: number
  oversized?: number
}): string | undefined {
  const { images, references, failed, outside, duplicates = 0, oversized = 0 } = summary
  const limit = `${String(MAX_IMAGE_BYTES / 1024 / 1024)} MB`
  let text = addedText(images, references)
  if (oversized > 0) {
    text = clause(text, `未添加：${String(oversized)} 张图片超过 ${limit}`, `另有 ${String(oversized)} 张图片超过 ${limit}，没有添加`)
  }
  if (failed > 0) text = clause(text, `未添加：${String(failed)} 个文件未能读取`, `另有 ${String(failed)} 个文件未能读取`)
  if (duplicates > 0) {
    text = clause(text, `没有重复添加：${String(duplicates)} 个文件已经在待发送内容中`,
      `另有 ${String(duplicates)} 个文件已经在待发送内容中，没有重复添加`)
  }
  if (outside > 0) {
    text += `。其中 ${String(outside)} 个在当前工作区外，已保留绝对路径；能否读取由引擎权限决定`
  }
  return text === "" ? undefined : `${text}。`
}
