/**
 * 流式期间，把**最后一段里还没闭合的行内标记**先补上。
 *
 * 一句「**换会话时要清滑窗**」要分七八批才到齐。收尾那对星号没到之前，解析器只能把开头
 * 那对当字面量印出来——于是大半秒里屏幕上是「**换会话时要清滑」，收尾一到整句忽然跳成粗体。
 * 行内代码的反引号同理。补上之后，粗体和代码从第一个字起就是它最后的样子，只是在变长。
 *
 * **只在流式那一支用**：定稿的正文原样交给解析器，一个字都不改。这里补的东西
 * 只活到下一批字到来，补错了也只错一帧。
 *
 * 只补两种：`**` 粗体与反引号代码——模型正文里最常见、一次跨的字也最多的就是这两种。
 * 单个 `*`、`_` 不碰：它们和列表符号、乘号、蛇形命名撞车，补错了比不补难看。
 * 链接、表格这类要整块到齐才成立的结构也不碰。
 *
 * 纯逻辑：不碰 DOM、不读时钟。
 */

/** 一个还没闭合的开头：在原文里的位置、几个符号长。 */
interface Open {
  at: number
  len: number
}

interface Tail {
  code: Open | undefined
  bold: Open | undefined
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** 这一行是不是围栏；是的话给出那串符号。反引号围栏的信息串里不许再有反引号（CommonMark）。 */
function fenceOf(line: string): string | undefined {
  const m = FENCE.exec(line)
  const run = m?.[1]
  if (run === undefined) return undefined
  if (run.startsWith("`") && (m?.[2] ?? "").includes("`")) return undefined
  return run
}

/** 收尾围栏：同一种符号、不短于开头、后面只许有空白。 */
function closes(line: string, open: string): boolean {
  const run = fenceOf(line)
  return run !== undefined && run[0] === open[0] && run.length >= open.length && line.trim() === run
}

/**
 * 最后一段从哪儿起：最后一个空行或围栏之后。**停在没闭合的围栏里就给 undefined**——
 * 那里面的星号和反引号都是代码本身；没闭合的围栏，解析器自己会画成一直延到末尾的代码块。
 */
function tailStart(text: string): number | undefined {
  let fence: string | undefined
  let start = 0
  let at = 0
  for (const line of text.split("\n")) {
    const next = at + line.length + 1
    if (fence === undefined) {
      fence = fenceOf(line)
      if (fence !== undefined || line.trim() === "") start = next
    } else if (closes(line, fence)) {
      fence = undefined
      start = next
    }
    at = next
  }
  return fence === undefined ? start : undefined
}

function runOf(text: string, i: number, ch: string): number {
  let j = i
  while (text[j] === ch) j += 1
  return j - i
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch.trim() === ""
}

/** 一串反引号：不在代码里就开一段；在代码里、而且一样长，就收掉。 */
function tick(text: string, i: number, tail: Tail): number {
  const len = runOf(text, i, "`")
  if (tail.code === undefined) tail.code = { at: i, len }
  else if (tail.code.len === len) tail.code = undefined
  return i + len
}

/**
 * 一串星号：只认正好两个的。开头后面得紧跟着字（或者已经到末尾、字还没来），
 * 收尾前面得紧挨着字——CommonMark 的「侧翼」，简化到够用。
 */
function star(text: string, i: number, tail: Tail): number {
  const len = runOf(text, i, "*")
  if (len !== 2) return i + len
  const after = text[i + 2]
  if (tail.bold === undefined && (after === undefined || !isSpace(after))) tail.bold = { at: i, len }
  else if (tail.bold !== undefined && !isSpace(text[i - 1])) tail.bold = undefined
  return i + len
}

/** 从 `from` 扫到末尾，记下还开着的代码与粗体。反斜杠转义只在代码外面算。 */
function scan(text: string, from: number): Tail {
  const tail: Tail = { code: undefined, bold: undefined }
  let i = from
  while (i < text.length) {
    const c = text[i]
    if (c === "`") i = tick(text, i, tail)
    else if (tail.code !== undefined) i += 1
    else if (c === "\\") i += 2
    else if (c === "*") i = star(text, i, tail)
    else i += 1
  }
  return tail
}

/**
 * 补上一个开头。后面还没有字：先把开头藏起来（补成一对空的，解析器会原样印出四个符号）。
 * 有字了：在末尾补一个一样长的收尾；收尾已经到了一半（粗体只到了一个星号）就只补差的那个。
 */
function seal(text: string, open: Open, mark: string): string {
  if (text.slice(open.at + open.len).trim() === "") return text.slice(0, open.at)
  const body = text.trimEnd()
  const half = mark === "*" && body.endsWith("*") && !isSpace(body[body.length - 2]) ? 1 : 0
  return body + mark.repeat(open.len - half)
}

export function mendTail(text: string): string {
  const from = tailStart(text)
  if (from === undefined) return text
  const tail = scan(text, from)
  let out = text
  if (tail.code !== undefined) out = seal(out, tail.code, "`")
  if (tail.bold !== undefined) out = seal(out, tail.bold, "*")
  return out
}
