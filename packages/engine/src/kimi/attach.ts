import type { KimiContent, KimiImageContent } from "./wire.js"

/**
 * 附件交给 Kimi 的是**路径**，不是图片本身——和 codex 的 `localImage` 一样。
 *
 * Kimi 公开的 prompt schema 收 `image.source.kind: "path"`：它自己读盘、自己按模型要求压缩，
 * 只要求绝对路径和本机 runtime，而 Switchback 起的正是本机 `kimi web`。
 *
 * 以前交 base64，撞上的是 `kimi web` 的请求体上限（Fastify 默认 1 MiB）：
 * 一张 800 多 KB 的 Retina 截图编码后就过线，整句被拒成 `Request body is too large`。
 * 读不到、不是图片、相对路径或敏感文件，Kimi 都会拒收整句并报原因——不会假装图片送到了。
 */
export function attachmentContent(attachments?: readonly string[]): readonly KimiImageContent[] {
  return (attachments ?? []).map((path) => ({ type: "image", source: { kind: "path", path } }))
}

export function promptContent(text: string, attachments?: readonly string[]): readonly KimiContent[] {
  const content: KimiContent[] = text === "" ? [] : [{ type: "text", text }]
  content.push(...attachmentContent(attachments))
  if (content.length === 0) throw new Error("Kimi 的提示内容不能为空")
  return content
}
