/** 桌面输入区允许交给各家引擎的图片格式。 */
const EXTENSION: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
}

const PATH_EXTENSION: Readonly<Record<string, true>> = {
  ".png": true,
  ".jpg": true,
  ".jpeg": true,
  ".gif": true,
  ".webp": true,
}

/** 单张上限；粘贴与拖拽必须共用，避免原图绕过主进程的落盘检查。 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export function imageExtension(mime: string): string | undefined {
  return EXTENSION[mime]
}

export function canAttachImage(file: Pick<File, "type" | "size">): boolean {
  return imageExtension(file.type) !== undefined && file.size > 0 && file.size <= MAX_IMAGE_BYTES
}

/** 系统文件选择器回来的路径还没有 `File.type`，按驱动接受的同一组扩展名核对。 */
export function canAttachImagePath(path: string, size: number): boolean {
  const dot = path.lastIndexOf(".")
  const extension = dot < 0 ? "" : path.slice(dot).toLowerCase()
  return PATH_EXTENSION[extension] === true && size > 0 && size <= MAX_IMAGE_BYTES
}

export interface PickedImages {
  paths: readonly string[]
  rejected: number
  canceled: boolean
}
