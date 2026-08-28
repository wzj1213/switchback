/**
 * 词级差异：一对删/增行里，**到底是哪几个字变了**。
 *
 * ## 为什么需要它
 *
 * 现在一对删/增行只有整行底色，于是「改了一个词」和「重写了整行」长得一模一样，
 * 你得**逐字比对两行中文**才能确认——那正是审核最耗神、也最容易看漏的动作。
 *
 * ## 为什么不用 `git --word-diff`
 *
 * 它产出的是另一种文本格式（`[-old-]{+new+}` 混在一行里），和现在这条
 * 「补丁一行一行画」的路子不搭：要么改取补丁那一层的格式、要么在渲染层算。
 * 这里选后者——它是个纯函数，配错了不会报错，只会让人盯着两行看半天，
 * 所以它有表驱动的测试钉着。
 *
 * ## 分词：中文按字，英文按词
 *
 * 中文没有空格，**按词切等于不切**（整行会变成一个 token，于是要么全标要么不标）。
 * 拉丁字母和数字按词切——把 `lastAnswerAt` 拆成 12 个字母去比，
 * 标出来的是一堆碎片，读起来比不标还累。
 */

/** 一个 token：连续的标识符、连续的空白，或**单独一个**其它字符（含每个汉字）。 */
const TOKEN = /[A-Za-z0-9_$]+|\s+|[\s\S]/gu

/**
 * 相似度闸门。**两行对得上的部分不足三成就整行不标**——那是重写不是改动，
 * 标满等于没标，还会把「这里只动了两个字」那种真正有用的信号稀释掉。
 *
 * **只拿实词算分，标点和空白不参与。** 这条是实测逼出来的：`splitRows` 按下标
 * 配对，于是一段大改里
 *
 * ```
 * -    const html = renderToStaticMarkup(createElement(ReviewDiff, {
 * +function render(split: boolean, path = "x.ts"): string {
 * ```
 *
 * 这样两行毫不相干的代码会被配到一起。它们**没有一个词是共同的**，可
 * `(`、`,`、`{`、`=`、`:` 和一堆空格全都对得上——按全部 token 算，相似度轻松过三成，
 * 于是整行被标满。**分母里塞满括号，这道闸门就等于没有。**
 */
const SIMILAR = 0.3

/**
 * LCS 是 O(n·m)。长行按 token 数设上限，超了整行不标——
 * 和上面那条闸门共用一个出口，调用方不必分辨是哪一种。
 */
const MAX_CELLS = 40_000

/** 一段要标出来的字符区间（左闭右开，按 `string` 的下标）。 */
export interface Span {
  start: number
  end: number
}

/** 纯空白或纯标点/符号的 token：它对得上并不说明两行像。 */
const FILLER = /^[\s\p{P}\p{S}]+$/u

interface Tok {
  text: string
  at: number
  /** 参不参与相似度计分。标出来的时候它照标，只是不算分。 */
  word: boolean
}

function tokens(text: string): readonly Tok[] {
  const out: Tok[] = []
  for (const match of text.matchAll(TOKEN)) {
    out.push({ text: match[0], at: match.index, word: !FILLER.test(match[0]) })
  }
  return out
}

/**
 * 最长公共子序列，回溯出「两侧各有哪些 token 对上了」。
 *
 * 表用一维 `Uint16Array` 而不是二维数组：40000 格的二维数组是 200 个小数组，
 * 分配开销比计算本身还大，而这条会在每次切文件时对整份补丁跑一遍。
 */
function align(a: readonly Tok[], b: readonly Tok[]): { keepA: boolean[]; keepB: boolean[] } {
  const w = b.length + 1
  const table = new Uint16Array((a.length + 1) * w)
  const at = (i: number, j: number): number => table[i * w + j] ?? 0
  const same = (i: number, j: number): boolean => a[i]?.text !== undefined && a[i]?.text === b[j]?.text
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * w + j] = same(i, j) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const keepA = new Array<boolean>(a.length).fill(false)
  const keepB = new Array<boolean>(b.length).fill(false)
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (same(i, j)) {
      keepA[i] = true
      keepB[j] = true
      i += 1
      j += 1
    } else if (at(i + 1, j) >= at(i, j + 1)) i += 1
    else j += 1
  }
  return { keepA, keepB }
}

/** 词之间那一个空格：两边都变了的时候它不算「没变的部分」。 */
const GAP_MAX = 2

/**
 * 没对上的相邻 token 并成一段。分开标会在一个词里画出好几块底色。
 *
 * **中间只隔一个空格的两段也要并**：`a bb cc d` → `a xx yy d` 里那个空格
 * 两侧都有、于是被判成「对上了」，可它并不是一处**没变的内容**——
 * 只是分词的副产物。不并的话画出来是两块中间夹一道白缝，读成了两处改动。
 * 只并短空白：对齐用的一长串空格是真的没变，桥过去会标出一片空的底色。
 */
function spans(text: string, toks: readonly Tok[], keep: readonly boolean[]): readonly Span[] {
  const out: Span[] = []
  for (const [index, tok] of toks.entries()) {
    if (keep[index]) continue
    const last = out.at(-1)
    const gap = last === undefined ? undefined : text.slice(last.end, tok.at)
    if (last !== undefined && gap !== undefined && gap.length <= GAP_MAX && gap.trim() === "") {
      last.end = tok.at + tok.text.length
    } else out.push({ start: tok.at, end: tok.at + tok.text.length })
  }
  return out
}

/**
 * 一对删/增行 → 两侧各要标的区间。
 *
 * 返回 `undefined` 表示**这一对不标**：太长、太不像、或者根本没差别。
 * 三种情况调用方的动作一样（整行只留底色），所以不分辨。
 */
export function wordMarks(del: string, add: string): { del: readonly Span[]; add: readonly Span[] } | undefined {
  if (del === "" || add === "" || del === add) return undefined
  const a = tokens(del)
  const b = tokens(add)
  if (a.length * b.length > MAX_CELLS) return undefined
  const { keepA, keepB } = align(a, b)
  const words = a.filter((tok) => tok.word).length + b.filter((tok) => tok.word).length
  const same = keepA.filter((on, index) => on && a[index]?.word === true).length
  if (words === 0 || 2 * same < SIMILAR * words) return undefined
  return { del: spans(del, a, keepA), add: spans(add, b, keepB) }
}
