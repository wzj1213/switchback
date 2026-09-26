/**
 * 流速表：**这一刻模型在以多快的速度吐字**。
 *
 * ## 它是速度表，不是业界那个 token/s
 *
 * 说清楚这件事比算得准更要紧。业界口径的 token/s 是**一整轮的商**
 *（真 token 数 ÷ 首字到末字），那个数在 `bench.ts` 里算，靶上单独显示。
 * 这里量的是**此刻**——最近 `WINDOW_MS` 里到手多少（估出来的）token——因为开火节奏
 * 需要一个每帧都能读的数，而一轮结束才有的商喂不了每一帧。
 *
 * 两个数不是一个东西，所以**画面上也不许长得像**：这儿的读数永远带波浪号。
 *
 * ## 这个窗口里有两个时钟
 *
 * - `Usage` **一轮只来一次**，在结账那一刻。它回答「这一轮花了多少」，是账。
 * - `item.delta` 是**逐帧**的。它回答「此刻在发生什么」。
 *
 * 流速属于后者，所以只能从 `item.delta` 的文字估。
 *
 * ## 文字怎么换成 token
 *
 * 每条 delta 先按字符种类估成 token（`tokens.ts`），这里记的就是估出来的那个数。
 * 早先记的是 UTF-8 字节、再除一个常数：中文一个字 3 字节却常常不到一个 token，
 * 英文 4 个字母才一个——除同一个常数，读数就跟着语言漂。
 *
 * 估数和真数之间还差一个倍率（各家分词器不一样），**倍率由调用方给**：
 * `rateOf` 收一个 `scale`，由 `bench.ts` 拿每轮结账的真 token 数学出来。
 * 这一层只做它本来的事：一个滑窗。
 *
 * ## 为什么是滑窗不是瞬时值
 *
 * 真实的流是**一簇一簇**的（一次 delta 到一批字，中间是网络的空档）。
 * 取瞬时值的话画面会在「爆表」和「零」之间抽搐，而人眼读到的是噪声。
 * 一个 `WINDOW_MS` 的滑窗把簇抹平成速度，同时保留「引擎变慢了」这件事。
 *
 * 纯逻辑：不读时钟（时间由调用方传入）、不碰 DOM。
 */

/** 一格样本：这一刻收到了多少（估出来的）token。 */
interface Mark {
  at: number
  tokens: number
}

/**
 * 滑窗长度。
 *
 * 1200ms 是试出来的：短于 800ms 时逐字吐的引擎和成段吐的引擎读起来一样抖；
 * 长于 2s 之后「它卡住了」要过两秒才看得出来，而那正是最该马上看见的一件事。
 */
const WINDOW_MS = 1200

/**
 * 环形缓冲的格数。
 *
 * 定长是**为了不在事件回调里分配内存**：吐字最快的时候每秒几十条 delta，
 * 每条都 push 一个对象、再定期 shift 掉，等于把 GC 拉进热路径。
 * 128 格在 1.2 秒的窗口里够用到每秒一百条 delta，远超任何引擎的实际频率；
 * 真溢出了就覆盖最旧的那格——那格本来也快出窗了。
 */
const SLOTS = 128

export interface Meter {
  /** 环形缓冲。**原地改**，不重建数组。 */
  readonly marks: Mark[]
  /** 下一个要写的格子。 */
  head: number
  /**
   * 最后一笔的时刻。**只为了让空闲时能一句话出结果**：
   * 静默是常态（一天里绝大多数帧都没有字在吐），而 `rateOf` 每帧要被调一次；
   * 没有这一项的话，那些帧全都得白扫一遍 128 格。
   */
  last: number
}

export function createMeter(): Meter {
  return { marks: Array.from({ length: SLOTS }, () => ({ at: 0, tokens: 0 })), head: 0, last: -1e12 }
}

/**
 * 记一笔。`at` 由调用方给（毫秒），**这里不读时钟**。
 *
 * 原地写而不是 push：见 `SLOTS` 那段。
 */
export function mark(meter: Meter, at: number, tokens: number): void {
  const slot = meter.marks[meter.head]
  if (slot === undefined) return
  slot.at = at
  slot.tokens = tokens
  meter.head = (meter.head + 1) % SLOTS
  if (at > meter.last) meter.last = at
}

/**
 * 此刻的流速（token/秒）。
 *
 * `scale` = 真数 ÷ 估数，**由调用方给**（`bench.ts` 从真数学出来的那个）。
 * 这一层不持有它，理由见文件头。
 *
 * 窗口里一笔都没有就是 0——**不是「上一次的值」**：静默恰恰是这套东西里
 * 最有意义的状态之一（没有输出就没有火力），把它平滑成一个衰减的尾巴，
 * 等于把「它停了」这件事藏起来。
 */
export function rateOf(meter: Meter, now: number, scale: number): number {
  // 窗口里必然一笔都没有——**绝大多数帧走的是这一条**
  if (meter.last <= now - WINDOW_MS) return 0
  const from = now - WINDOW_MS
  let tokens = 0
  for (const slot of meter.marks) {
    if (slot.at > from && slot.at <= now) tokens += slot.tokens
  }
  if (tokens === 0) return 0
  return (tokens * scale) / (WINDOW_MS / 1000)
}

/**
 * 把窗口清空。**换会话、换引擎时必须调**：上一条会话的流速不属于这一条，
 * 不清的话切过去的头一秒画面上是别人的速度。
 */
export function clearMeter(meter: Meter): void {
  for (const slot of meter.marks) {
    slot.at = 0
    slot.tokens = 0
  }
  meter.head = 0
  meter.last = -1e12
}
