import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app, ipcMain } from "electron"

/** 允许贴进来的图片类型。**白名单**——不认的一律不落盘。 */
const EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
}

/** 单张上限。截图很少超过几 MB，而一张几十 MB 的图对模型也没有意义。 */
const MAX_BYTES = 12 * 1024 * 1024

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
export function installAttachChannel(): void {
  ipcMain.handle("omni:stashImage", async (_e, req: { mime: string; bytes: ArrayBuffer }) => {
    const ext = EXT[req.mime]
    if (ext === undefined) return undefined
    const buf = Buffer.from(req.bytes)
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return undefined
    const dir = join(app.getPath("userData"), "attachments")
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${stamp()}${ext}`)
    await writeFile(path, buf)
    return path
  })
}

/** 文件名带时间，同一秒内贴两张也不撞（后缀随机四位）。 */
function stamp(): string {
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, "0")
  const day = `${String(now.getFullYear())}${p(now.getMonth() + 1)}${p(now.getDate())}`
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `${day}-${time}-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`
}
