/**
 * 纸带上落的字：**模型此刻真在写的那些字**。
 *
 * 上一版纸带上印的是一串写死的字（「模型上下文进度环token流速……」）轮着用，
 * 于是不管它在写中文、写代码还是写表格，带子上永远是同一句读不通的话。
 * 这里记下最近到手的那几十个字，每落一发取一个——写代码时带子上是括号和标识符，
 * 写中文时是中文。
 *
 * 一发代表好几个 token（见 `pet-shots.ts`），字来得比子弹快，所以这里**只留最近的一截**：
 * 攒得太多就从旧的那头丢，带子上印的永远是刚写出来的东西，而不是半分钟前的。
 *
 * 纯逻辑：不读时钟、不碰 DOM。
 */
export interface TapeText {
  /** 最近到手的字，旧的在前。空白不进来：纸带上落一个空格等于什么都没落。 */
  chars: string[]
  /** 下一发取哪一个。 */
  read: number
}

/** 最多留多少个字。 */
const KEEP = 48

export function createTapeText(): TapeText {
  return { chars: [], read: 0 }
}

export function pushText(tape: TapeText, text: string): void {
  for (const ch of text) {
    if (ch.trim() === "") continue
    tape.chars.push(ch)
  }
  const extra = tape.chars.length - KEEP
  if (extra > 0) {
    tape.chars.splice(0, extra)
    tape.read = Math.max(0, tape.read - extra)
  }
}

/**
 * 下一发落哪个字。**没有新字了就再落最后那个**（而不是一个点）：
 * 静默的那一下带子本来就该停，字只在收尾的几发上重复，读起来仍然是那段话的尾巴。
 */
export function nextChar(tape: TapeText): string {
  const ch = tape.chars[tape.read]
  if (ch !== undefined) {
    tape.read += 1
    return ch
  }
  return tape.chars[tape.chars.length - 1] ?? "·"
}

/** 换会话：上一条会话写的字不属于这一条。 */
export function clearTapeText(tape: TapeText): void {
  tape.chars.length = 0
  tape.read = 0
}
