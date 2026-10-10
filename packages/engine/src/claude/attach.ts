import { randomUUID } from "node:crypto"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { loadImages } from "../image.js"

/**
 * 附件那一路：文本 ＋ 图片路径 → SDK 的消息内容。
 *
 * 从 `driver.ts` 拆出来是行数闸门逼的（那边 307 行），这一刀也顺：
 * 那边是「一条会话的生命周期」，这边只回答「一句话怎么打包成内容块」。
 */

/**
 * 文本 ＋ 附件 → SDK 的消息内容。
 *
 * 没有附件时**仍然给字符串**，不是单元素数组：那条路每天走几百次，
 * 形状不变最安全。
 *
 * 图片要读成 base64——SDK 走的是 Anthropic 的内容块，那边只认内联数据，
 * 没有「给个路径你自己读」的形式（codex 有，所以那边用 `localImage`）。
 * 任一张读不出来就明确拒绝整句：转录区已经显示了这些附件，少送一张再继续
 * 会让界面撒谎；更不能把 Switchback 自己编的“没送达”说明塞进模型上下文。
 */
export async function toContent(
  text: string,
  attachments: readonly string[] | undefined,
): Promise<SDKUserMessage["message"]["content"]> {
  if (attachments === undefined || attachments.length === 0) return text
  const images = await loadImages(attachments)
  const blocks: unknown[] = images.map(({ mime, data }) => ({
    type: "image", source: { type: "base64", media_type: mime, data: data.toString("base64") },
  }))
  // Anthropic 不接受空 text block；只发图片也是合法提示。
  if (text !== "") blocks.push({ type: "text", text })
  return blocks as SDKUserMessage["message"]["content"]
}

/**
 * 普通提示与即时插话共用同一份人类消息封装，只有 priority 不同。
 *
 * 每条都带 uuid：Claude 的中断回执只按 uuid 点名「还会照跑」的消息（见 `halt.ts`）。
 */
export async function toUserMessage(
  text: string,
  attachments: readonly string[] | undefined,
  sessionId: string,
  priority?: SDKUserMessage["priority"],
): Promise<SDKUserMessage & { uuid: string }> {
  return {
    type: "user",
    message: { role: "user", content: await toContent(text, attachments) },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
    ...(priority === undefined ? {} : { priority }),
  }
}
