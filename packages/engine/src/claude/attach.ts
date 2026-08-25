import { readFile } from "node:fs/promises"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"

/**
 * 附件那一路：文本 ＋ 图片路径 → SDK 的消息内容。
 *
 * 从 `driver.ts` 拆出来是行数闸门逼的（那边 307 行），这一刀也顺：
 * 那边是「一条会话的生命周期」，这边只回答「一句话怎么打包成内容块」。
 */

/** 认得出的图片类型。**认不出就不送**——把一个 zip 当成图片塞过去，模型那边只会报错。 */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

/**
 * 文本 ＋ 附件 → SDK 的消息内容。
 *
 * 没有附件时**仍然给字符串**，不是单元素数组：那条路每天走几百次，
 * 形状不变最安全。
 *
 * 图片要读成 base64——SDK 走的是 Anthropic 的内容块，那边只认内联数据，
 * 没有「给个路径你自己读」的形式（codex 有，所以那边用 `localImage`）。
 * 读不出来的（文件没了、权限不对）**跳过并在文本里说一声**，
 * 而不是整条消息发不出去：用户已经按了回车，那句话本身还是该送到。
 */
export async function toContent(
  text: string,
  attachments: readonly string[] | undefined,
): Promise<SDKUserMessage["message"]["content"]> {
  if (attachments === undefined || attachments.length === 0) return text
  const blocks: unknown[] = []
  const failed: string[] = []
  for (const path of attachments) {
    const mime = IMAGE_MIME[extOf(path)]
    if (mime === undefined) {
      failed.push(`${path}（不是认得出的图片类型）`)
      continue
    }
    const data = await readFile(path, { encoding: "base64" }).catch(() => undefined)
    if (data === undefined) {
      failed.push(`${path}（读不出来）`)
      continue
    }
    blocks.push({ type: "image", source: { type: "base64", media_type: mime, data } })
  }
  const note = failed.length === 0 ? "" : `\n\n（这些附件没能送达：${failed.join("、")}）`
  blocks.push({ type: "text", text: text + note })
  return blocks as SDKUserMessage["message"]["content"]
}

/** 普通提示与即时插话共用同一份人类消息封装，只有 priority 不同。 */
export async function toUserMessage(
  text: string,
  attachments: readonly string[] | undefined,
  sessionId: string,
  priority?: SDKUserMessage["priority"],
): Promise<SDKUserMessage> {
  return {
    type: "user",
    message: { role: "user", content: await toContent(text, attachments) },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...(priority === undefined ? {} : { priority }),
  }
}

function extOf(path: string): string {
  const at = path.lastIndexOf(".")
  return at === -1 ? "" : path.slice(at).toLowerCase()
}
