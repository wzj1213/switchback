/**
 * 输入框里的 `@文件` 引用。**纯函数**——光标位置的边界条件很多，
 * 这些必须能脱离 DOM 被穷举。
 */
import { formatFileReference } from "./file-references.js"

export interface Mention {
  /** `@` 的下标 */
  start: number
  /** 光标下标（token 的结束位置） */
  end: number
  /** `@` 之后到光标之间的查询串，可能为空 */
  query: string
}

/**
 * 光标处有没有一个正在输入的 `@` 引用。
 *
 * 三条判据缺一不可：
 * - `@` 前面必须是**行首或空白**——`user@host` 里的那个不是引用
 * - `@` 与光标之间不能有空白——空格一打就说明这次引用结束了
 * - 只看光标**之前**：光标后面还有别的字不影响这一次
 */
export function mentionAt(text: string, caret: number): Mention | undefined {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at === -1) return undefined
  const prev = at === 0 ? " " : (before[at - 1] ?? " ")
  if (!/\s/.test(prev)) return undefined
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return undefined
  return { start: at, end: caret, query }
}

/** 把 token 替换成选中的路径，并在后面补一个空格。返回新文本与新光标位置。 */
export function applyMention(
  text: string,
  mention: Mention,
  path: string,
): { text: string; caret: number } {
  const inserted = `${formatFileReference(path)} `
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(mention.end),
    caret: mention.start + inserted.length,
  }
}
