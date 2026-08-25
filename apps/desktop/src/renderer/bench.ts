/**
 * 一轮的**成绩**：TTFT 和 t/s，按业界口径算。
 *
 * ## 为什么滑窗那个数不是「token/s」
 *
 * `throughput.ts` 量的是**此刻**：最近 1.2 秒里到手多少字节。那是个速度表，
 * 开火节奏得按它走。但没有人把速度表上的读数叫作「这个模型的 token/s」——
 * 业界那个数是**一整轮的商**，而且分子分母两边都和滑窗不是一回事：
 *
 * - **分子**是引擎报的**真 token 数**（`Usage.outputTokens`），不是字节除以一个常数。
 *   一个 token 在英文/代码里约 4 字节，在中文里约 3 字节却常一字一 token——
 *   同一个真实速度，按字节估的读数在两种语言下能差出四分之一。
 * - **分母是「首字到末字」，不含 TTFT**。这是 TPOT 的倒数，也是 llama.cpp 的
 *   `eval time … tokens per second`、各家评测里的 Output Speed 用的口径。
 *   把等首字那段算进去的话，一次慢握手会把生成速度也一起拖下水，
 *   而那是两件该分开看的事——所以 **TTFT 单列，永远和 t/s 一起报**。
 *
 * ## 报不上来的那几家怎么办
 *
 * claude 和 grok 报得出这一轮的生成量，**kimi、codex、通用 ACP 报不出**
 *（各自的理由记在 `kimi/state.ts` 和 `Usage.outputTokens` 里）。
 * 那几家这里退回按字节估，**并且数字前面留着波浪号**——那个波浪号是这套东西里
 * 唯一分得清「真数」和「估数」的地方，不能因为好看就抹掉。
 *
 * ## 估的那一路会自己学
 *
 * 常数不再写死。每跑完一轮**真数**在手的轮次，就拿这一轮的
 * `字节 ÷ token` 修正一次 `bpt`——于是同一台机器上跑久了，估出来的那个数会
 * 朝真数收敛，而且是**按你自己的语言和这家引擎**收敛的。
 * 顺带它还吸收掉一个我们看不见的偏差：工具调用的参数也算模型的输出 token，
 * 但它们不以 `item.delta` 的形式过来，于是字节天然偏少——学出来的 `bpt` 会自动补上。
 *
 * 纯逻辑：不读时钟（时间由调用方传入）、不碰 DOM。
 */

/** 一轮跑完之后的成绩。**没跑完就没有**——半轮的商没有意义。 */
export interface Bench {
  /** 首字延迟（秒）：从这一轮开跑，到第一个字到手。 */
  ttft: number
  /** 解码速度（token/秒）：生成量 ÷（末字 − 首字）。**不含 TTFT**。 */
  tps: number
  /** 这一轮生成了多少 token。 */
  tokens: number
  /** 上面这些是不是真数。false = 引擎没报生成量，按字节估的，界面要打波浪号。 */
  exact: boolean
}

/**
 * 出厂的字节/token。**只在学到第一个真数之前用**，见文件头。
 *
 * 3.2 是中英之间的一个折中值。它一定不准，但它只需要撑到第一轮结账。
 */
export const BPT_GUESS = 3.2

/**
 * 学出来的 `bpt` 夹在这个区间里。
 *
 * 越界的样本一律不要：一轮里模型只吐了两个字就收工、或者引擎把生成量报成了
 * 会话累计（kimi 那种），算出来的比值会离谱到几十甚至零点几。
 * **一个坏样本会污染之后每一帧的读数**，而这条线之外的样本没有一个是可信的。
 */
const BPT_MIN = 1.2
const BPT_MAX = 8

/**
 * 新样本占多少权重。
 *
 * 0.5 是「两轮就基本到位，但一轮的抖动不会一次打满」。再高就等于不平滑，
 * 再低则换一种语言之后要好几轮才跟得上。
 */
const LEARN = 0.5

/**
 * 一轮的账本。**原地改**——和这一层其余每一样一样（见 `pet-fx.ts` 里那段）。
 */
export interface Run {
  /** 这一轮开跑的时刻（ms）。`undefined` = 这条会话还没跑过。 */
  from: number | undefined
  /** 这一轮收工的时刻。`undefined` = **还在跑**。 */
  till: number | undefined
  /** 第一个字到手的时刻。TTFT 的另一端。 */
  first: number | undefined
  /** 最后一个字到手的时刻。 */
  last: number | undefined
  /** 这一轮到手的输出字节。**只算模型自己说的话**，见 `flow-scope.ts`。 */
  bytes: number
  /** 引擎报的生成量。报不上来就一直是 `undefined`。 */
  tokens: number | undefined
  /** 上一轮的成绩。**跨轮活着**：跑完之后那个数要一直挂在靶上给人看。 */
  done: Bench | undefined
  /** 学出来的字节/token。见文件头。 */
  bpt: number
  /**
   * 这一轮的真数已经拿去校准过了。
   *
   * **一轮只许学一次。** `score` 会被调不止一次（用量迟到时要重算），
   * 而同一个样本连学两次等于把它的权重翻倍，几轮下来常数会被一轮的抖动带跑。
   */
  learned: boolean
}

export function createRun(): Run {
  return {
    from: undefined,
    till: undefined,
    first: undefined,
    last: undefined,
    bytes: 0,
    tokens: undefined,
    done: undefined,
    bpt: BPT_GUESS,
    learned: false,
  }
}

/** 开一轮。**上一轮的成绩留着**——它还挂在靶上，要等这一轮结账才换。 */
export function begin(run: Run, at: number): void {
  run.from = at
  run.till = undefined
  run.first = undefined
  run.last = undefined
  run.bytes = 0
  run.tokens = undefined
  run.learned = false
}

/**
 * 到了一批字。
 *
 * `first` **只在第一次落笔**：TTFT 的定义就是「第一个」，被后面的覆盖掉的话
 * 它会一路缩水成「最后一批字之间的间隔」。
 */
export function feed(run: Run, at: number, bytes: number): void {
  if (bytes <= 0 || run.from === undefined || run.till !== undefined) return
  run.first ??= at
  run.last = at
  run.bytes += bytes
}

/**
 * 引擎报了这一轮的生成量。**取最后一次报的**：一轮里可能报好几次，越后面越全。
 *
 * **迟到也认。** claude 是先报用量再报收工，而不是每一家都这个顺序；
 * 顺序反过来时若不认，那一轮就白白退回估数了——明明真数已经到手。
 * 所以收工之后再来一条，就拿它把刚算出来的成绩重算一遍。
 */
export function report(run: Run, tokens: number): void {
  if (run.from === undefined || tokens <= 0) return
  run.tokens = tokens
  if (run.till !== undefined) score(run)
}

/** 结账。**一轮的成绩只在这儿产生**。 */
export function settle(run: Run, at: number): void {
  if (run.from === undefined || run.till !== undefined) return
  run.till = at
  score(run)
}

/**
 * 算这一轮的成绩，顺带**用真数校准估算常数**。
 *
 * 一个字都没吐的轮次不留成绩：那种轮次的商是零除零，而**上一轮的成绩比一个
 * 假的零有用**——所以这时保留原来那个，不覆盖。
 */
function score(run: Run): void {
  const { from, till, first, bytes } = run
  if (from === undefined || till === undefined || first === undefined || bytes <= 0) return
  // 末字取最后一批字的时刻；引擎收工前若一直没再吐字，用收工时刻会把那段静默
  // 算进生成时长，于是「它想了很久才收工」被记成「它吐得很慢」
  const last = Math.max(run.last ?? first, first)
  const exact = run.tokens !== undefined
  if (run.tokens !== undefined && !run.learned) learn(run, bytes / run.tokens)
  const tokens = run.tokens ?? bytes / run.bpt
  // 单批就收工时首末同刻，解码时长是 0、商是无穷。**退回端到端口径**（含 TTFT）
  // 而不是不给数：那种轮次「多久拿到这些字」本来就是唯一说得清的问题
  const span = last > first ? last - first : till - from
  if (span <= 0) return
  run.done = {
    ttft: (first - from) / 1000,
    tps: tokens / (span / 1000),
    tokens: Math.round(tokens),
    exact,
  }
}

/** 用一轮真数修一次常数。越界的样本直接丢，理由见 `BPT_MIN`。 */
function learn(run: Run, sample: number): void {
  run.learned = true
  if (!(sample >= BPT_MIN && sample <= BPT_MAX)) return
  run.bpt += (sample - run.bpt) * LEARN
}

/**
 * 换会话：把账本清回出厂。
 *
 * **`bpt` 也清**——它是跟着「哪家引擎、什么语言」学出来的，
 * 换条会话很可能就换了一家，带过去的话头几轮的估数会朝着上一家偏。
 */
export function clearRun(run: Run): void {
  const fresh = createRun()
  run.from = fresh.from
  run.till = fresh.till
  run.first = fresh.first
  run.last = fresh.last
  run.bytes = fresh.bytes
  run.tokens = fresh.tokens
  run.done = fresh.done
  run.bpt = fresh.bpt
  run.learned = fresh.learned
}
