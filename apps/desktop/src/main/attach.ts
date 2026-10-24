import { mkdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { dialog, ipcMain, nativeImage } from "electron"
import {
  imageExtension,
  MAX_IMAGE_BYTES,
  type PickedFiles,
} from "../shared/attachments.js"
import { thumbnailSize, type AttachmentFiles } from "./attachment-files.js"
import { pickedFilesOf } from "./picked-files.js"
import type { Channels } from "./channels.js"
import type { Locale } from "@switchback/i18n"
import { ATTACH } from "./attach.messages.js"

async function pickFiles(files: AttachmentFiles, locale: Locale): Promise<PickedFiles> {
  const result = await dialog.showOpenDialog({
    title: ATTACH[locale].pick,
    properties: ["openFile", "multiSelections"],
  })
  if (result.canceled) return { files: [], failed: 0, canceled: true }
  return pickedFilesOf(result.filePaths, (paths) => { files.allow(paths) })
}

/**
 * 把剪贴板里的图片落到盘上，返回路径。
 *
 * ## 为什么要落盘而不是直接把字节传下去
 *
 * 两家引擎都更喜欢路径：codex 的 `localImage` 只收路径（走 `image` 要把整张图
 * 塞进 JSON-RPC，一张截图几 MB，管道会被撑爆）；Claude 那边虽然最终要 base64，
 * 但由驱动自己读文件也比让字节穿过 IPC → 渲染层 → IPC 再回来强。
 *
 * 而且落盘之后**这张图是可回溯的**：会话记录里存的是路径，
 * 事后想看看「当时贴的是哪张图」还能打开。
 *
 * 放 `userData` 下而不是临时目录：临时目录会被系统清掉，
 * 而会话记录里的路径会指向一个不存在的文件——那比没有更糟。
 */
/**
 * 贴图请求逐个字段核。本机窗口传来的是 `ArrayBuffer`；远程模式下宿主收到的是线上
 * 还原出来的 `Buffer`（`remote/calls.ts`）——而远程那头传什么都有可能，不核就是
 * 拿 `Buffer.from(undefined)` 去试。
 */
function stashRequestOf(value: unknown): { mime: string; buf: Buffer } | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { mime, bytes } = value as { mime?: unknown; bytes?: unknown }
  if (typeof mime !== "string") return undefined
  if (bytes instanceof ArrayBuffer) return { mime, buf: Buffer.from(bytes) }
  return bytes instanceof Uint8Array ? { mime, buf: Buffer.from(bytes) } : undefined
}

export function installAttachChannel(files: AttachmentFiles, channels: Channels, locale: () => Locale): void {
  ipcMain.handle("switchback:pickFiles", () => pickFiles(files, locale()))
  channels.handle("switchback:stashImage", async (value: unknown) => {
    const req = stashRequestOf(value)
    if (req === undefined) return undefined
    const ext = imageExtension(req.mime)
    if (ext === undefined) return undefined
    const buf = req.buf
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return undefined
    const dir = files.dir
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${stamp()}-${randomUUID()}${ext}`)
    await writeFile(path, buf)
    return path
  })
  channels.on("switchback:discardImages", (paths: unknown) => {
    if (!Array.isArray(paths)) return
    void files.discard(paths.filter((path): path is string => typeof path === "string").slice(0, 100))
  })
  ipcMain.on("switchback:allowAttachmentPaths", (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return
    files.allow(paths.filter((path): path is string => typeof path === "string").slice(0, 100))
  })
  channels.handle("switchback:thumb", (req: unknown) => {
    if (typeof req !== "object" || req === null) return undefined
    const { path, max } = req as { path?: unknown; max?: unknown }
    const size = thumbnailSize(max)
    if (typeof path !== "string" || size === undefined || !files.allows(path)) return undefined
    return thumb(path, size)
  })
}

/**
 * 读一张图，缩到边长不超过 `max`，返回 data URL。
 *
 * ## 为什么不让渲染层直接 `<img src="file://…">`
 *
 * CSP 是 `img-src 'self' data:`——`file:` 被挡着。而放宽 CSP 为了显示缩略图，
 * 等于让渲染层能引用**盘上任意路径**；这条通道只认本次粘贴、用户亲手挑选/拖入，
 * 或会话历史真实引用过的路径，并把请求边长封顶在 2048。
 *
 * ## 为什么在主进程缩
 *
 * 一张 12MB 的截图转成 data URL 是 16MB 的字符串，穿过 IPC 再由渲染层缩，
 * 缩完了那 16MB 还挂在字符串上。在这边缩完再传，走线的通常是几十 KB。
 *
 * 缩略图和大图走同一个入口、只差一个 `max`：预览时再要一次大的，
 * 而不是一开始就按最大尺寸传——列表里有五张图时那是五倍的浪费。
 */
function thumb(path: string, max: number): string | undefined {
  const image = nativeImage.createFromPath(path)
  // 路径不存在、或者根本不是图片时 `createFromPath` 不抛，返回一张**空图**。
  // 不挡住的话渲染层会拿到一个 `data:image/png;base64,` 的空壳，画出来是个破框
  if (image.isEmpty()) return undefined
  const { width, height } = image.getSize()
  const long = Math.max(width, height)
  // 本来就小于目标就别放大：放大只会糊，而且体积还涨
  const fit = long <= max ? image : image.resize(width >= height ? { width: max } : { height: max })
  return fit.toDataURL()
}

/** 时间方便排查；UUID 保证同一秒批量粘贴也不会覆盖上一张。 */
function stamp(): string {
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, "0")
  const day = `${String(now.getFullYear())}${p(now.getMonth() + 1)}${p(now.getDate())}`
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `${day}-${time}`
}
