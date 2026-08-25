import type { KimiContent, KimiImageContent } from "./wire.js"
import { loadImages, mimeOfImage } from "../image.js"

export { mimeOfImage as imageMime }

/** prompt 与 skill activation 共用 Kimi 公开的 base64 image source。 */
export async function attachmentContent(attachments?: readonly string[]): Promise<readonly KimiImageContent[]> {
  return (await loadImages(attachments)).map(({ mime, data }) => (
    {
      type: "image",
      source: { kind: "base64", media_type: mime, data: data.toString("base64") },
    }
  ))
}

/** Kimi 的公开 prompt schema 接受 base64 image source；读失败必须明确抛错，不能假装图片送到了。 */
export async function promptContent(text: string, attachments?: readonly string[]): Promise<readonly KimiContent[]> {
  const content: KimiContent[] = text === "" ? [] : [{ type: "text", text }]
  content.push(...(await attachmentContent(attachments)))
  if (content.length === 0) throw new Error("Kimi 的提示内容不能为空")
  return content
}
