import { readFile, stat } from "node:fs/promises"
import { extname } from "node:path"

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

async function loadImage(path: string): Promise<LoadedImage> {
  const mime = mimeOfImage(path)
  if (mime === undefined) throw new Error(`不支持的图片格式：${path}`)
  const info = await stat(path).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new Error(`附件读不到：${path}`)
  if (info.size === 0) throw new Error(`附件是空文件：${path}`)
  if (info.size > MAX_INLINE_IMAGE_BYTES) throw new Error(`附件超过 12 MB：${path}`)
  const data = await readFile(path).catch(() => undefined)
  if (data === undefined) throw new Error(`附件读不到：${path}`)
  if (data.byteLength > MAX_INLINE_IMAGE_BYTES) throw new Error(`附件超过 12 MB：${path}`)
  return { path, mime, data }
}

/** 保序并行读取；任一失败就拒绝整句，不能让转录记录声称所有图片都已送达。 */
export function loadImages(paths: readonly string[] | undefined): Promise<readonly LoadedImage[]> {
  return Promise.all((paths ?? []).map(loadImage))
}
