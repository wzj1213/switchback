import { readFile } from "node:fs/promises"

/**
 * 附件 → ACP 的提示词内容块。
 *
 * 从驱动里拆出来是行数闸门逼的，但边界本来就该有：驱动的日常是收通知、发提示、
 * 落事件，而「一个本地文件怎么变成协议认的内容块」是一件自成一体的事——
 * 而且它是**唯一会读用户磁盘上任意文件**的一段，单独放着更容易看清。
 */

/**
 * 形状是**实测出来的**：`{type:"image", data:<base64>, mimeType}`，
 * 拿一张写着 `KIMI-4417` 的图发过去，agent 把那串字念了回来。
 *
 * 和 codex 那边（给路径）不一样，ACP 要 base64——协议里没有「本地文件」这种块，
 * 而 agent 可能根本不在同一台机器上。
 *
 * **不支持图片的 agent 一个块都不发**（`allowed` 为假）：塞过去要么报错、
 * 要么被静默丢掉，而后者更糟——界面上显示「已附上」，模型其实没看见。
 * 读不出来的文件跳过，不因为一张图毁掉整句话。
 */
export async function imageBlocks(
  paths: readonly string[] | undefined,
  allowed: boolean,
): Promise<readonly unknown[]> {
  if (paths === undefined || paths.length === 0 || !allowed) return []
  const blocks: unknown[] = []
  for (const path of paths) {
    const data = await readFile(path).catch(() => undefined)
    if (data === undefined) continue
    blocks.push({ type: "image", data: data.toString("base64"), mimeType: mimeOf(path) })
  }
  return blocks
}

/**
 * 按扩展名认图片类型。**认不出就当 PNG**——协议要一个 mimeType，
 * 而这里唯一的替代方案是不发这张图，那比猜错格式糟：
 * 多数 agent 自己会嗅探真实字节。
 */
export function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  return "image/png"
}
