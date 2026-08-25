import { open, realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, relative, resolve } from "node:path"
import { ipcMain, nativeImage } from "electron"
import type { FilePreview, FilePreviewRequest } from "../shared/file-preview.js"

const MAX_TEXT = 1_500_000
const MAX_IMAGE = 1600
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"])
const HTML_EXT = new Set([".html", ".htm"])
const LANG: Readonly<Record<string, string>> = {
  ".css": "css", ".go": "go", ".html": "html", ".htm": "html", ".js": "javascript",
  ".json": "json", ".jsx": "jsx", ".md": "markdown", ".mjs": "javascript", ".py": "python",
  ".rs": "rust", ".sh": "shell", ".toml": "toml", ".ts": "typescript", ".tsx": "tsx",
  ".txt": "text", ".yaml": "yaml", ".yml": "yaml",
}

function unavailable(
  path: string,
  reason: Extract<FilePreview, { kind: "unavailable" }>["reason"],
  message: string,
): FilePreview {
  return { kind: "unavailable", path, name: basename(path), reason, message }
}

function beneath(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

async function safeTarget(req: FilePreviewRequest): Promise<string | FilePreview> {
  if (typeof req?.cwd !== "string" || typeof req.path !== "string" || req.cwd === "" || req.path === "") {
    return unavailable("", "failed", "没有可预览的文件路径。")
  }
  const lexicalRoot = resolve(req.cwd)
  const lexicalTarget = resolve(lexicalRoot, req.path)
  if (!beneath(lexicalRoot, lexicalTarget)) {
    return unavailable(lexicalTarget, "outside", "只能预览当前工作区里的文件。")
  }
  try {
    const [root, target] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)])
    return beneath(root, target)
      ? target
      : unavailable(lexicalTarget, "outside", "这个路径通过符号链接离开了当前工作区。")
  } catch {
    return unavailable(lexicalTarget, "missing", "文件已经不存在，或者暂时无法读取。")
  }
}

function imagePreview(path: string): FilePreview | undefined {
  if (!IMAGE_EXT.has(extname(path).toLowerCase())) return undefined
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) return undefined
  const size = image.getSize()
  const long = Math.max(size.width, size.height)
  const fit = long <= MAX_IMAGE
    ? image
    : image.resize(size.width >= size.height ? { width: MAX_IMAGE } : { height: MAX_IMAGE })
  return { kind: "image", path, name: basename(path), dataUrl: fit.toDataURL() }
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, "r")
  try {
    const buffer = Buffer.alloc(bytes)
    const read = await file.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, read.bytesRead)
  } finally {
    await file.close()
  }
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  if (sample.includes(0)) return true
  let controls = 0
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1
  return sample.length > 0 && controls / sample.length > 0.08
}

export async function previewFile(req: FilePreviewRequest): Promise<FilePreview> {
  const target = await safeTarget(req)
  if (typeof target !== "string") return target
  try {
    const info = await stat(target)
    if (!info.isFile()) return unavailable(target, "directory", "这是一个目录，不能作为文件预览。")
    const image = imagePreview(target)
    if (image !== undefined) return image
    const truncated = info.size > MAX_TEXT
    const buffer = await readHead(target, Math.min(info.size, MAX_TEXT))
    if (looksBinary(buffer)) return unavailable(target, "binary", "这是二进制文件，不能按文本预览。")
    const ext = extname(target).toLowerCase()
    return {
      kind: HTML_EXT.has(ext) ? "html" : "text",
      path: target,
      name: basename(target),
      text: buffer.toString("utf8"),
      truncated,
      ...(LANG[ext] === undefined ? {} : { language: LANG[ext] }),
    }
  } catch {
    return unavailable(target, "failed", "读取这份文件失败，请稍后重试。")
  }
}

export function installFilePreviewChannel(): void {
  ipcMain.handle("omni:filePreview", (_event, req: FilePreviewRequest) => previewFile(req))
}
