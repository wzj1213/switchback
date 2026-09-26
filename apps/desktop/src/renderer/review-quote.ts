import type { NumberedLine } from "./review-lines.js"

/**
 * 审查页里「引用这一段」：把一个 hunk 连同位置写成人会贴进对话的那种样子——
 *
 * ```text
 * src/a.ts:12-15
 * ```diff
 *  上下文
 * -删掉的
 * +加上的
 * ```
 * ```
 *
 * **只有位置和原样的改动，没有一句 omni 写的话**：它进的是输入框里一枚看得见、删得掉的芯片，
 * 你在前面写「这里不对」还是「照这个改法把别处也改了」，是你的话。`路径:行号` 是各家都认的写法，
 * 引擎拿到就能自己去打开那几行。
 */

/** 一段最多附这么多行。再长的 hunk 贴进对话里谁也读不完，剩下的让它自己去文件里看。 */
const MAX_LINES = 300

const PREFIX: Readonly<Record<NumberedLine["kind"], string>> = { add: "+", del: "-", ctx: " ", hunk: "", meta: "" }

/** 从 hunk 头往下，到下一个 hunk 或文件头为止。 */
export function hunkBody(lines: readonly NumberedLine[], at: number): readonly NumberedLine[] {
  const body: NumberedLine[] = []
  for (let index = at + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || line.kind === "hunk" || line.kind === "meta") break
    body.push(line)
  }
  return body
}

/** 行号范围：有新侧的行就按新侧（改动之后文件里的位置），纯删除的才按旧侧。 */
function rangeOf(body: readonly NumberedLine[]): string {
  const fresh = body.map((line) => line.new).filter((n): n is number => n !== undefined)
  const numbers = fresh.length > 0 ? fresh : body.map((line) => line.old).filter((n): n is number => n !== undefined)
  if (numbers.length === 0) return ""
  const [low, high] = [Math.min(...numbers), Math.max(...numbers)]
  return low === high ? `:${String(low)}` : `:${String(low)}-${String(high)}`
}

/** 围栏要比正文里最长的一串反引号还长一个，不然代码里的 ``` 会把块提前截断。 */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length))
  return "`".repeat(Math.max(3, longest + 1))
}

export function quoteHunk(rel: string, lines: readonly NumberedLine[], at: number): string | undefined {
  const body = hunkBody(lines, at)
  if (body.length === 0) return undefined
  const shown = body.slice(0, MAX_LINES)
  const text = [...shown.map((line) => `${PREFIX[line.kind]}${line.text}`), ...(body.length > shown.length ? ["…"] : [])].join("\n")
  const fence = fenceFor(text)
  return `${rel}${rangeOf(body)}\n${fence}diff\n${text}\n${fence}`
}

/** 芯片上那行字：哪个文件的哪几行。 */
export function quoteLabel(quote: string): string {
  return `引用 ${quote.split("\n")[0] ?? ""}`
}
