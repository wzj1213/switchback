/**
 * 从「改之前 / 改之后」两份文本**合成** diff。
 *
 * ## 谁需要它
 *
 * - **Claude**：`Edit` 递过来的是 `old_string` / `new_string`，`Write` 递的是整份
 *   `content`——都不是 diff。不合成的话，Claude 会话里的文件改动在界面上是一片空白。
 * - **ACP 三家**（kimi / grok / zcode）：`session/update` 的 diff 内容块给的同样是
 *   `oldText` / `newText` 两份**全文**。上一版直接把 `newText` 当 diff 塞进去、
 *   增删数按「整份文件有多少行」算——于是 500 行的文件里改一行，界面上写着 **+500 −500**，
 *   而那份「diff」逐行过渡染色器之后，正文里以 `-` 或 `+` 开头的行（Markdown 列表、
 *   YAML）全被画成红绿。
 *
 * 所以它住在包的根上，不住在某一家的目录里。
 *
 * ⚠️ 这**不是**真正的逐行 diff（没有 LCS）。做法是：掐掉首尾相同的行，
 * 中间整块按「旧的全删、新的全增」呈现。对 `Edit` 那种小范围替换读起来
 * 和真 diff 没区别；对一次替换几十行的情况会显得笨，但不会**说错**——
 * 删的确实删了，增的确实增了。
 */

const CONTEXT = 2

function lines(text: string): readonly string[] {
  if (text === "") return []
  const raw = text.split("\n")
  return raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw
}

function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) return i
  }
  return max
}

/** 后缀不能和前缀重叠，否则同一行会被同时算进上下文两端。 */
function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix
  for (let i = 0; i < max; i += 1) {
    if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return i
  }
  return Math.max(0, max)
}

export interface Synth {
  diff: string
  added: number
  removed: number
}

export function synthDiff(oldText: string, newText: string): Synth {
  const a = lines(oldText)
  const b = lines(newText)
  const p = commonPrefix(a, b)
  const s = commonSuffix(a, b, p)
  const removed = a.slice(p, a.length - s)
  const added = b.slice(p, b.length - s)
  const head = a.slice(Math.max(0, p - CONTEXT), p)
  const tail = a.slice(a.length - s, a.length - s + CONTEXT)
  const body = [
    ...head.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...tail.map((l) => ` ${l}`),
  ]
  return { diff: body.join("\n"), added: added.length, removed: removed.length }
}
