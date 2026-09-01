import { appendFileReferences, formatFileReference } from "./file-references.js"

/**
 * 输入框上方那排「待发的东西」。
 *
 * ## 为什么拖进来的文件不再写成一整行路径
 *
 * 上一版把拖入的文件写成正文里的 `@绝对路径`，理由是「它仍是输入框里可见、
 * 可编辑的用户文本，不另造隐藏附件协议」。**前半句现在仍然成立，后半句换了实现**：
 * 从访达拖一张图或一份 PDF 进来，得到的是
 * `@"/Users/…/Downloads/report-2026-08-30-final.pdf"` 横在正文中间——
 * 你还没开始打字，输入框已经被一条你根本不需要读的字符串占满了。
 *
 * 现在它是一枚芯片：**显示的是同一条路径，只是排版换了**（文件名醒目、
 * 上一级目录压暗、整条在悬停里），发送时原样展开成和以前一模一样的
 * `@路径`。没有隐藏协议——芯片和那段文本是 1:1 的，转录区里也照旧看得见。
 *
 * ## 为什么大段粘贴也归这里
 *
 * 同一个病的另一种发作：粘一段 500 行的日志进去，输入框（`max-height: 180px`）
 * 就此变成一个只能滚的小窗口，你要在里面找自己那句话。而**会话历史里
 * 这段日志本来就是折起来的**——输入框没道理比历史更吵。
 *
 * 折起来的是显示，不是内容：发送时它原样接在正文后面，一个字都不改。
 */

/** 一枚待发的芯片。 */
export type DraftBlock =
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "paste"; text: string }

/**
 * 多大算「大」。
 *
 * 输入框最高 180px，正文行高 20px——九行满。**十行是它开始变成滚动窗口的那一刻**，
 * 所以行数闸门定在十。字数那条管的是另一种：一行两千字的 JSON 只有一行，
 * 但它照样把输入框撑成一团。
 */
export const PASTE_LINES = 10
export const PASTE_CHARS = 1000

export function worthFolding(text: string): boolean {
  return text.split("\n").length >= PASTE_LINES || text.length >= PASTE_CHARS
}

/** 芯片上写什么：文件名醒目、上一级目录压暗；整条路径留给 `title`。 */
export function fileChip(path: string): { parent: string; name: string } {
  const parts = path.split("/")
  const name = parts.pop() ?? path
  const parent = parts.pop()
  return { parent: parent === undefined || parent === "" ? "" : `${parent}/`, name }
}

/** 粘贴芯片上那行字。行数是人对「这坨有多大」的直觉单位，字节只在够大时才补。 */
export function pasteChip(text: string): string {
  const lines = text.split("\n").length
  const kb = text.length / 1024
  return kb < 1
    ? `粘贴文本 · ${String(lines)} 行`
    : `粘贴文本 · ${String(lines)} 行 · ${kb.toFixed(kb < 10 ? 1 : 0)} KB`
}

function pathsOf(blocks: readonly DraftBlock[]): readonly string[] {
  return blocks.flatMap((block) => (block.kind === "file" ? [block.path] : []))
}

/** 这条路径已经在芯片里了。重复拖同一个文件不再加第二枚。 */
export function hasFile(blocks: readonly DraftBlock[], path: string): boolean {
  return pathsOf(blocks).includes(path)
}

/**
 * 发送时真正送出去的那段话。
 *
 * 顺序是定的：**你打的字在前，附上的东西在后**。不管你是先粘日志再打
 * 「看看这个报错」还是反过来，出来的都是同一段——一个会随操作顺序变的结果
 * 没人说得清，而说不清的顺序等于随机。
 *
 * 文件引用走 `appendFileReferences`（和手打 `@` 完全同一条路，含去重与补空格）；
 * 粘贴块各自空一行隔开——它们常常是日志或代码，贴在一起会连成一坨。
 */
export function composeDraft(text: string, blocks: readonly DraftBlock[]): string {
  const withFiles = referencedText(text, blocks)
  const pastes = blocks.flatMap((block) => (block.kind === "paste" ? [block.text] : []))
  if (pastes.length === 0) return withFiles
  const head = withFiles.trimEnd()
  return [head, ...pastes].filter((part) => part !== "").join("\n\n")
}

/**
 * 去重用的「现在已经引用了哪些文件」。**只拼文件那一半**——
 * 粘贴块动辄几百 KB，而它对「这个文件在不在里面」没有任何影响；
 * 每次渲染都把它拼一遍纯属白干。
 */
export function referencedText(text: string, blocks: readonly DraftBlock[]): string {
  return appendFileReferences(text, pathsOf(blocks))
}

/** 这枚芯片在正文里长什么样。供「已经引用过了吗」这类判断复用同一套措辞。 */
export function blockText(block: DraftBlock): string {
  return block.kind === "file" ? formatFileReference(block.path) : block.text
}
