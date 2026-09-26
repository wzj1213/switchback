/**
 * 一段文字大约多少 token。**按字符种类估，不按字节。**
 *
 * 流速的分子该是真 token 数。引擎报得出的时候用真数（见 `bench.ts`），
 * 报不出、以及一轮还没收工的时候只能估。上一版按 UTF-8 字节除一个常数（出厂 3.2），
 * 而同一段话的「字节 / token」在中文、英文、代码里能差出一倍：
 * 中文一个字 3 字节、常常还不到一个 token，英文 4 个字母才 1 个 token。
 * 于是**同一个真实速度，写中文时读数虚高六七成**——不是「不准」，是跟着语言漂。
 *
 * 按字符种类给权重是各家「粗估 token」的通用做法：英文约 4 个字符一个，
 * 中日韩约 1.3 个字一个，标点常和邻居并成一个，空格并进后面那个词。
 * 它仍然是估，所以界面上带 ≈；真数到手之后 `bench.ts` 会拿它校准一个倍率，
 * 按你这台机器上的语言和这家引擎的分词器收敛。
 *
 * 纯逻辑：不读时钟、不碰 DOM。每条 delta 都要走一遍，所以只用 `charCodeAt`，不分配。
 */

/** 中日韩：汉字、假名、谚文。一个字约 0.75 个 token（各家分词器 1.2~1.6 字一个）。 */
const CJK = 0.75
/** 拉丁字母与数字：约 3.6 个一个 token（英文正文连空格约 4 个字符一个）。 */
const LETTER = 0.28
/** 半角标点与符号：常和邻居并成一个（`();`、`=>`），平均算半个不到。 */
const MARK = 0.4
/** 全角标点（，。「」：）：各家分词器里基本一个一个算。 */
const WIDE_MARK = 1
/** 换行：代码里换行加缩进常是单独一个 token；正文里偶尔并进去。 */
const NEWLINE = 0.5
/** 其余（表情、生僻字、别的文字）：按一个算。 */
const OTHER = 1

function isCjk(c: number): boolean {
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0xac00 && c <= 0xd7af) ||
    (c >= 0xf900 && c <= 0xfaff)
  )
}

function isLetter(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0xc0 && c <= 0x24f && c !== 0xd7 && c !== 0xf7)
  )
}

function isWideMark(c: number): boolean {
  return (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x2010 && c <= 0x206f)
}

/** 一个 UTF-16 码元（BMP 里的字）算多少。代理对由调用方处理。 */
function weightOf(c: number): number {
  if (isLetter(c)) return LETTER
  if (isCjk(c)) return CJK
  if (c === 0x0a) return NEWLINE
  if (c <= 0x20) return 0
  if (c < 0x7f) return MARK
  return isWideMark(c) ? WIDE_MARK : OTHER
}

export function estimateTokens(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      // 代理对：两个码元一个字（表情、扩展区汉字）
      n += OTHER
      i++
      continue
    }
    n += weightOf(c)
  }
  return n
}
