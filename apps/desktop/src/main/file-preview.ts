import { open, realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, relative, resolve } from "node:path"
import { nativeImage } from "electron"
import type { ThreadId } from "@switchback/protocol"
import type { FilePreview, FilePreviewRequest } from "../shared/file-preview.js"
import type { TouchedFiles } from "./touched.js"
import type { WorksiteSearch } from "./worksite-search.js"
import type { Channels } from "./channels.js"

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

/**
 * 工作区之外还有第二道门：**这条会话自己读过或改过的那些文件**。
 *
 * 侧栏列的就是它们（技能文档、`/tmp` 里的中间产物、引擎自己的后台日志），
 * 一律挡住等于「列得出来、打不开」。名册由主进程按事件流记，见 `touched.ts`；
 * 渲染层说什么不算数。
 */
export type PreviewGuard = (threadId: ThreadId, cwd: string, path: string) => boolean
export type WorkspaceGuard = (threadId: ThreadId, cwd: string) => boolean

function requestOf(value: unknown): FilePreviewRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const req = value as Partial<FilePreviewRequest>
  if (typeof req.threadId !== "string" || req.threadId === "") return undefined
  if (typeof req.cwd !== "string" || req.cwd === "") return undefined
  if (typeof req.path !== "string" || req.path === "") return undefined
  return { threadId: req.threadId, cwd: req.cwd, path: req.path }
}

/** 这条会话自己报过这条路径吗。认不出会话就一律当没报过。 */
function reported(req: FilePreviewRequest, touched: PreviewGuard): boolean {
  if (typeof req.threadId !== "string" || req.threadId === "") return false
  return touched(req.threadId, req.cwd, req.path)
}

async function safeTarget(req: FilePreviewRequest, touched: PreviewGuard): Promise<string | FilePreview> {
  const lexicalRoot = resolve(req.cwd)
  const lexicalTarget = resolve(lexicalRoot, req.path)
  const noted = reported(req, touched)
  if (!noted && !beneath(lexicalRoot, lexicalTarget)) {
    return unavailable(lexicalTarget, "outside", "这个文件在工作区外，而且这条会话没读过它。")
  }
  try {
    const [root, target] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)])
    // 会话读过的那份，符号链接指到哪儿都照读——引擎早就把内容拿走了，
    // 这里再挡一次只挡得住用户自己
    return noted || beneath(root, target)
      ? target
      : unavailable(lexicalTarget, "outside", "这个路径通过符号链接离开了当前工作区。")
  } catch {
    return unavailable(lexicalTarget, "missing", "文件已经不存在，或者暂时无法读取。")
  }
}

/** 文件监听复用预览的两道安全门；不满足时不暴露目标路径，也不起 watcher。 */
export async function previewWatchTarget(
  value: unknown,
  touched: PreviewGuard,
  owns: WorkspaceGuard,
): Promise<string | undefined> {
  const req = requestOf(value)
  if (req === undefined || !owns(req.threadId, req.cwd)) return undefined
  const target = await safeTarget(req, touched)
  return typeof target === "string" ? target : undefined
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

export async function previewFile(
  value: unknown,
  touched: PreviewGuard,
  owns: WorkspaceGuard,
): Promise<FilePreview> {
  const req = requestOf(value)
  if (req === undefined) return unavailable("", "failed", "没有可预览的文件路径。")
  if (!owns(req.threadId, req.cwd)) {
    return unavailable(req.path, "outside", "这条会话没有使用这个工作区，不能预览其中的文件。")
  }
  const target = await safeTarget(req, touched)
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

export function installFilePreviewChannel(touched: TouchedFiles, worksites: WorksiteSearch, channels: Channels): void {
  channels.handle("switchback:filePreview", (req: unknown) => (
    previewFile(req, touched.allows, worksites.owns)
  ))
}
