import { readFile, stat } from "node:fs/promises"
import { extname } from "node:path"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { IMAGE } from "./image.messages.js"

const MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

/** base64 驱动的单图上限；防止远程命令或旧日志绕过桌面输入区检查。 */
export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024

export interface LoadedImage {
  path: string
  mime: string
  data: Buffer
}

export function mimeOfImage(path: string): string | undefined {
  return MIME[extname(path).toLowerCase()]
}

async function loadImage(path: string, m: (typeof IMAGE)[Locale]): Promise<LoadedImage> {
  const mime = mimeOfImage(path)
  if (mime === undefined) throw new Error(m.format(path))
  const info = await stat(path).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new Error(m.unreadable(path))
  if (info.size === 0) throw new Error(m.empty(path))
  if (info.size > MAX_INLINE_IMAGE_BYTES) throw new Error(m.tooLarge(path))
  const data = await readFile(path).catch(() => undefined)
  if (data === undefined) throw new Error(m.unreadable(path))
  if (data.byteLength > MAX_INLINE_IMAGE_BYTES) throw new Error(m.tooLarge(path))
  return { path, mime, data }
}

/** 保序并行读取；任一失败就拒绝整句，不能让转录记录声称所有图片都已送达。 */
export function loadImages(paths: readonly string[] | undefined, locale: Locale = DEFAULT_LOCALE): Promise<readonly LoadedImage[]> {
  return Promise.all((paths ?? []).map((path) => loadImage(path, IMAGE[locale])))
}
