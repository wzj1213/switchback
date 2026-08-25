/**
 * 流速表：**这一刻模型在以多快的速度吐字**。
 *
 * ## 为什么必须自己估，不能拿 `Usage` 里的数
 *
 * 这个窗口里有**两个时钟**，而它们的刻度完全不同：
 *
 * - `Usage`（`contextUsed` / `totalTokens` / `cacheRead`）**一轮只来一次**，
 *   在结账那一刻。它回答的是「这一轮花了多少」，是账。
 * - `item.delta` 是**逐帧**的：一次事件到一批字。它回答的是「此刻在发生什么」。
 *
 * 流速属于后者，所以只能从 `item.delta` 的字节量估。**估出来的数永远写作
 * `~142 t/s`**——那个波浪号不是谦虚，是说清楚它和账单上的数不是同一个东西，
 * 免得有人拿它去对账。
 *
 * ## 字节怎么换成 token
 *
 * 没有通用答案：同一段 UTF-8，英文和代码大约 4 字节一个 token，中文一个字
 * 三字节却往往一个字一个 token 甚至更碎。`BYTES_PER_TOKEN` 取 3.2 是两头之间
 * 的一个折中——**它不需要准，它需要稳定**：画面上要说的是「快了还是慢了」，
 * 而那是个比值，常数取多少都不影响。
 *
 * ## 为什么是滑窗不是瞬时值
 *
 * 真实的流是**一簇一簇**的（一次 delta 到一批字，中间是网络的空档）。
 * 取瞬时值的话画面会在「爆表」和「零」之间抽搐，而人眼读到的是噪声。
 * 一个 `WINDOW_MS` 的滑窗把簇抹平成速度，同时保留「引擎变慢了」这件事。
 *
 * 纯逻辑：不读时钟（时间由调用方传入）、不碰 DOM。
 */

/** 一格样本：这一刻收到了多少字节。 */
interface Mark {
  at: number
  bytes: number
}

/**
 * 滑窗长度。
 *
 * 1200ms 是试出来的：短于 800ms 时逐字吐的引擎和成段吐的引擎读起来一样抖；
 * 长于 2s 之后「它卡住了」要过两秒才看得出来，而那正是最该马上看见的一件事。
 */
const WINDOW_MS = 1200

/** 见文件头。**不需要准，需要稳定。** */
const BYTES_PER_TOKEN = 3.2

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
  return { marks: Array.from({ length: SLOTS }, () => ({ at: 0, bytes: 0 })), head: 0, last: -1e12 }
}

/**
 * 记一笔。`at` 由调用方给（毫秒），**这里不读时钟**。
 *
 * 原地写而不是 push：见 `SLOTS` 那段。
 */
export function mark(meter: Meter, at: number, bytes: number): void {
  const slot = meter.marks[meter.head]
  if (slot === undefined) return
  slot.at = at
  slot.bytes = bytes
  meter.head = (meter.head + 1) % SLOTS
  if (at > meter.last) meter.last = at
}

/**
 * 此刻的流速（token/秒）。
 *
 * 窗口里一笔都没有就是 0——**不是「上一次的值」**：静默恰恰是这套东西里
 * 最有意义的状态之一（没有输出就没有火力），把它平滑成一个衰减的尾巴，
 * 等于把「它停了」这件事藏起来。
 */
export function rateOf(meter: Meter, now: number): number {
  // 窗口里必然一笔都没有——**绝大多数帧走的是这一条**
  if (meter.last <= now - WINDOW_MS) return 0
  const from = now - WINDOW_MS
  let bytes = 0
  for (const slot of meter.marks) {
    if (slot.at > from && slot.at <= now) bytes += slot.bytes
  }
  if (bytes === 0) return 0
  return bytes / BYTES_PER_TOKEN / (WINDOW_MS / 1000)
}

/**
 * 把窗口清空。**换会话、换引擎时必须调**：上一条会话的流速不属于这一条，
 * 不清的话切过去的头一秒画面上是别人的速度。
 */
export function clearMeter(meter: Meter): void {
  for (const slot of meter.marks) {
    slot.at = 0
    slot.bytes = 0
  }
  meter.head = 0
  meter.last = -1e12
}
