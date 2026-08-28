import { codeLanguage, highlightLines, type CodeSeg } from "./highlight.js"
import type { NumberedLine } from "./review-lines.js"
import { wordMarks, type Span } from "./review-words.js"

/**
 * 补丁正文该怎么画：语法着色 + 词级高亮，合成每行的分段。
 *
 * ## 为什么这两件事在同一个文件里
 *
 * 它们最终要落在**同一批字**上：一行里既有「这是关键字」也有「这几个字变了」，
 * 两套边界必须一起切，分两遍各切各的只会切出一堆嵌套 span。
 * 所以这里的出口只有一个 `paintPatch`，渲染层拿到的是**已经合过的**扁平分段。
 *
 * ## 三道闸门
 *
 * 1. 一次只染当前打开的那一个文件（`ReviewDiff` 本来就只拿到一个文件的补丁）；
 * 2. 超过 `MAX_LINES` 行整份退回纯文本——大补丁的渲染开销不值这点颜色，
 *    `PatchSkip.large` 已有先例；
 * 3. 逐行的闸门在 `review-words.ts` 里（太长、太不像的整行不标）。
 *
 * ## 已知的限度：配对是逐行对位的
 *
 * 和 `splitRows` 同一条规则——一段连续的删配一段连续的增，按下标配对。
 * 整段重排、删增行数不等时，会把内容并不对应的两行配到一起，标出来的比真正
 * 改动的多。相似度闸门挡掉最离谱的那类，剩下的挡不住。**这是逐行 diff 的通病**，
 * 要更准得先做行级配对（Patience / Myers），不在本轮。
 */

/** 渲染一行要的全部信息：一截文字 + 它的语法色 + 它是不是「变了的那几个字」。 */
export interface Seg {
  text: string
  cls?: string
  hit?: boolean
}

/** 超过这个行数整份不染。四百行的补丁已经没人逐行读了，那时要的是快。 */
const MAX_LINES = 3000

/** 按 hunk 切开。**meta 行不进组**：文件头不是代码，喂给高亮器只会乱。 */
function hunks(lines: readonly NumberedLine[]): readonly (readonly NumberedLine[])[] {
  const out: NumberedLine[][] = []
  for (const line of lines) {
    if (line.kind === "hunk" || out.length === 0) out.push([])
    if (line.kind === "ctx" || line.kind === "del" || line.kind === "add") out.at(-1)?.push(line)
  }
  return out
}

/**
 * 一段 hunk 的着色。**分成旧侧和新侧各扫一遍**——删行和增行拼在一起
 * 本来就不是一份合法的源码，块注释和字符串会在交界处错开。
 *
 * 上下文行两侧都有，取**新侧**那一份：那是改完之后的样子，也是人在读的那一份。
 */
function syntax(
  lang: string | undefined,
  group: readonly NumberedLine[],
  into: Map<NumberedLine, readonly CodeSeg[]>,
): void {
  const older = group.filter((line) => line.kind !== "add")
  const newer = group.filter((line) => line.kind !== "del")
  const oldSegs = highlightLines(lang, older.map((line) => line.text))
  const newSegs = highlightLines(lang, newer.map((line) => line.text))
  older.forEach((line, index) => {
    const seg = oldSegs[index]
    if (line.kind === "del" && seg !== undefined) into.set(line, seg)
  })
  newer.forEach((line, index) => {
    const seg = newSegs[index]
    if (seg !== undefined) into.set(line, seg)
  })
}

/** 一段连续的删配一段连续的增，逐行对位——和 `splitRows` 同一条规则。 */
function marks(group: readonly NumberedLine[], into: Map<NumberedLine, readonly Span[]>): void {
  let dels: NumberedLine[] = []
  let adds: NumberedLine[] = []
  const drain = (): void => {
    for (let i = 0; i < Math.min(dels.length, adds.length); i += 1) {
      const del = dels[i]
      const add = adds[i]
      const pair = del === undefined || add === undefined ? undefined : wordMarks(del.text, add.text)
      if (del === undefined || add === undefined || pair === undefined) continue
      into.set(del, pair.del)
      into.set(add, pair.add)
    }
    dels = []
    adds = []
  }
  for (const line of group) {
    if (line.kind === "del") dels.push(line)
    else if (line.kind === "add") adds.push(line)
    else drain()
  }
  drain()
}

/** 语法色的边界和词级高亮的边界一起切。两套边界不对齐是常态，取并集。 */
function cut(text: string, segs: readonly CodeSeg[], hits: readonly Span[]): readonly Seg[] {
  const base: readonly CodeSeg[] = segs.length > 0 ? segs : [{ text }]
  if (hits.length === 0) return base
  const out: Seg[] = []
  let at = 0
  for (const seg of base) {
    const end = at + seg.text.length
    while (at < end) {
      const inside = hits.find((hit) => hit.start <= at && at < hit.end)
      const next = hits.find((hit) => hit.start > at)?.start ?? end
      const stop = Math.min(end, inside === undefined ? next : inside.end)
      out.push({
        text: text.slice(at, stop),
        ...(seg.cls === undefined ? {} : { cls: seg.cls }),
        ...(inside === undefined ? {} : { hit: true }),
      })
      at = stop
    }
  }
  return out
}

/**
 * 整份补丁 → 每行的分段。
 *
 * **没什么可画的行不进表**：调用方 `get` 到 `undefined` 就照旧直接印 `line.text`，
 * 于是纯文本那条路一个对象都不多分配。
 */
export function paintPatch(
  path: string | undefined,
  lines: readonly NumberedLine[],
): ReadonlyMap<NumberedLine, readonly Seg[]> {
  const out = new Map<NumberedLine, readonly Seg[]>()
  if (lines.length > MAX_LINES) return out
  const lang = path === undefined ? undefined : codeLanguage(path)
  const segs = new Map<NumberedLine, readonly CodeSeg[]>()
  const hits = new Map<NumberedLine, readonly Span[]>()
  for (const group of hunks(lines)) {
    syntax(lang, group, segs)
    marks(group, hits)
  }
  for (const line of lines) {
    const seg = segs.get(line) ?? []
    const hit = hits.get(line) ?? []
    // **没有一截真的要变样就不进表。** 高亮器对一行纯文本也会还一段无类的分段，
    // 照收的话渲染层平白多包一层 span——那正是这张表要省掉的东西
    if (seg.some((one) => one.cls !== undefined) || hit.length > 0) out.set(line, cut(line.text, seg, hit))
  }
  return out
}
