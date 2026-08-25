/** 桌面输入区允许交给各家引擎的图片格式。 */
const EXTENSION: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
}

/** 单张上限；粘贴与拖拽必须共用，避免原图绕过主进程的落盘检查。 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export function imageExtension(mime: string): string | undefined {
  return EXTENSION[mime]
}

export function canAttachImage(file: Pick<File, "type" | "size">): boolean {
  return imageExtension(file.type) !== undefined && file.size > 0 && file.size <= MAX_IMAGE_BYTES
}
