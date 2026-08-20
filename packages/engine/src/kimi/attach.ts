import { readFile } from "node:fs/promises"
import type { KimiContent } from "./wire.js"

const MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  png: "image/png",
}

export function imageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  return MIME[ext] ?? "image/png"
}

/** Kimi 的公开 prompt schema 接受 base64 image source；读失败必须明确抛错，不能假装图片送到了。 */
export async function promptContent(text: string, attachments?: readonly string[]): Promise<readonly KimiContent[]> {
  const content: KimiContent[] = text === "" ? [] : [{ type: "text", text }]
  for (const path of attachments ?? []) {
    const data = await readFile(path)
    content.push({
      type: "image",
      source: { kind: "base64", media_type: imageMime(path), data: data.toString("base64") },
    })
  }
  if (content.length === 0) throw new Error("Kimi 的提示内容不能为空")
  return content
}
