/**
 * 一轮的**成绩**：TTFT 和 tok/s，按业界口径算。
 *
 * ## 为什么滑窗那个数不是「token/s」
 *
 * `throughput.ts` 量的是**此刻**：最近 1.2 秒里到手多少。那是个速度表，
 * 开火节奏得按它走。但没有人把速度表上的读数叫作「这个模型的 token/s」——
 * 业界那个数是**生成量 ÷ 生成时长**，而且两边都和滑窗不是一回事：
 *
 * - **分子**是引擎报的**真 token 数**（`Usage.outputTokens`）。报不出的那几家按字符种类估
 *  （`tokens.ts`），并且界面上带 ≈——那是分得清「真数」和「估数」的唯一地方。
 * - **分母是「真在出字的时间」**：不含等首字那段（TTFT 单列），也不含**中途停下来**的那些空档——
 *   中间插了一次工具调用就算停了（见 `pause`）；别的时候两批字之间隔了超过 `GAP_MS` 也算停了。
 *   这是 TPOT 的倒数，也是 llama.cpp 的 `eval time … tokens per second`、各家评测里的
 *   Output Speed 用的口径。上一版的分母是「首字到末字」，一轮里只要调过一次两分钟的工具，
 *   读数就被拖成个位数——量到的是这一轮有多长，不是它吐得多快。
 *
 * ## 报不上来的那几家怎么办
 *
 * claude 和 grok 报得出这一轮的生成量，**kimi、codex、通用 ACP 报不出**
 *（各自的理由记在 `kimi/state.ts` 和 `Usage.outputTokens` 里）。
 * 那几家这里退回估数，数字前面留着 ≈。
 *
 * ## 估的那一路会自己校准
 *
 * 各家分词器不一样，同一段字的真 token 数能差出三四成。所以估数再乘一个倍率 `scale`：
 * 每跑完一轮**真数**在手的轮次，就拿这一轮的「真数 ÷ 估数」修正一次——
 * 同一台机器上跑久了，估出来的数会朝这家引擎的真数收敛。顺带它还吸收掉一个我们看不见的偏差：
 * 工具调用的参数也算模型的输出 token，但它们不以 `item.delta` 的形式过来。
 *
 * 纯逻辑：不读时钟（时间由调用方传入）、不碰 DOM。
 */

/** 一轮跑完之后的成绩。**没跑完就没有**——半轮的商没有意义。 */
export interface Bench {
  /** 首字延迟（秒）：从这一轮开跑，到第一个字到手。 */
  ttft: number
  /** 生成速度（token/秒）：生成量 ÷ 真在出字的时间。**不含 TTFT，也不含中途的空档**。 */
  tps: number
  /** 这一轮生成了多少 token。 */
  tokens: number
  /** 上面这些是不是真数。false = 引擎没报生成量，按字节估的，界面要打波浪号。 */
  exact: boolean
}

/**
 * 出厂的倍率（真数 ÷ 估数）。**只在学到第一个真数之前用**，见文件头。
 * `tokens.ts` 的权重本来就按常见分词器定，所以从 1 起步。
 */
export const SCALE_GUESS = 1

/**
 * 学出来的倍率夹在这个区间里。
 *
 * 越界的样本一律不要：一轮里模型只吐了两个字就收工、引擎把生成量报成了会话累计
 *（kimi 那种）、或者这一轮大半的输出都在工具参数里（写文件），算出来的比值会离谱到零点几或十几。
 * **一个坏样本会污染之后每一帧的读数**，而这条线之外的样本没有一个是可信的。
 */
const SCALE_MIN = 0.4
const SCALE_MAX = 2.5

/**
 * 新样本占多少权重。
 *
 * 0.5 是「两轮就基本到位，但一轮的抖动不会一次打满」。再高就等于不平滑，
 * 再低则换一种语言之后要好几轮才跟得上。
 */
const LEARN = 0.5

/**
 * 两批字之间隔多久就算「停下来了」。
 *
 * 流式输出的两批之间通常是几十到几百毫秒；调工具、跑命令、想事情时一停就是好几秒。
 * 1.5 秒以内的间隔算在出字时间里（网络抖一下不该让速度虚高），超过就不算。
 */
export const GAP_MS = 1500

/** 真在出字的时间攒到这么多才给速度：几百毫秒里的商抖得没有意义。 */
const MIN_FLOW_MS = 400

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
  /** 上一批字到手的时刻。中途插进一次工具调用就清掉（见 `pause`），下一批从新一段算起。 */
  last: number | undefined
  /** 这一轮到手的字，估成 token。**只算模型自己说的话**，见 `flow-scope.ts`。 */
  est: number
  /**
   * 「连着出字」那些时间里到手的估数。每一段的头一批不算：那一批是在空档之后到的，
   * 它花了多久没法量——和业界算 TPOT 时不算第一个 token 是同一个道理。
   */
  flowEst: number
  /** 连着出字的时长（ms）。两批之间隔了超过 `GAP_MS` 的，那段空档不算。 */
  flowMs: number
  /** 引擎报的生成量。报不上来就一直是 `undefined`。 */
  tokens: number | undefined
  /** 上一轮的成绩。**跨轮活着**：跑完之后那个数要一直挂在靶上给人看。 */
  done: Bench | undefined
  /** 学出来的倍率（真数 ÷ 估数）。见文件头。 */
  scale: number
  /**
   * 这一轮的真数已经拿去校准过了。
   *
   * **一轮只许学一次。** `score` 会被调不止一次（用量迟到时要重算），
   * 而同一个样本连学两次等于把它的权重翻倍，几轮下来倍率会被一轮的抖动带跑。
   */
  learned: boolean
}

export function createRun(): Run {
  return {
    from: undefined,
    till: undefined,
    first: undefined,
    last: undefined,
    est: 0,
    flowEst: 0,
    flowMs: 0,
    tokens: undefined,
    done: undefined,
    scale: SCALE_GUESS,
    learned: false,
  }
}

/** 开一轮。**上一轮的成绩留着**——它还挂在靶上，要等这一轮结账才换。 */
export function begin(run: Run, at: number): void {
  run.from = at
  run.till = undefined
  run.first = undefined
  run.last = undefined
  run.est = 0
  run.flowEst = 0
  run.flowMs = 0
  run.tokens = undefined
  run.learned = false
}

/**
 * 到了一批字（`est` 是估出来的 token 数）。
 *
 * `first` **只在第一次落笔**：TTFT 的定义就是「第一个」，被后面的覆盖掉的话
 * 它会一路缩水成「最后一批字之间的间隔」。和上一批隔得近，这段时间就算进出字时长；
 * 隔得远（调工具、想事情），这一批是新一段的开头，时长和字数都不进速度的账。
 */
export function feed(run: Run, at: number, est: number): void {
  if (est <= 0 || run.from === undefined || run.till !== undefined) return
  if (run.last !== undefined && at - run.last <= GAP_MS) {
    run.flowMs += Math.max(0, at - run.last)
    run.flowEst += est
  }
  run.first ??= at
  run.last = at
  run.est += est
}

/**
 * 中间插进来一次工具调用（或别的不是它在说话的事）：**下一批字另起一段**。
 *
 * 模型发起工具调用，这一次生成就结束了；工具跑完得再发一次请求、再等一遍首字。
 * 这段空档短的时候不到一秒（读个小文件），光靠 `GAP_MS` 挡不住，会被算成出字时间，
 * 把读数往下拽——而它本来就是下一次请求的首字延迟，和「分母不含 TTFT」是同一件事。
 */
export function pause(run: Run): void {
  if (run.till === undefined) run.last = undefined
}

/**
 * 这一轮**此刻**的生成速度（token/秒），和收工后的成绩同一个口径。
 * 真在出字的时间还没攒够（`MIN_FLOW_MS`）就是 `undefined`——几百毫秒里的商只是噪声。
 */
export function speedOf(run: Run): number | undefined {
  if (run.from === undefined || run.flowMs < MIN_FLOW_MS || run.flowEst <= 0) return undefined
  return (run.flowEst * run.scale) / (run.flowMs / 1000)
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
 * 算这一轮的成绩，顺带**用真数校准估算倍率**。
 *
 * 一个字都没吐的轮次不留成绩：那种轮次的商是零除零，而**上一轮的成绩比一个
 * 假的零有用**——所以这时保留原来那个，不覆盖。
 */
function score(run: Run): void {
  const { from, till, first, est } = run
  if (from === undefined || till === undefined || first === undefined || est <= 0) return
  const exact = run.tokens !== undefined
  if (run.tokens !== undefined && !run.learned) learn(run, run.tokens / est)
  const total = run.tokens ?? est * run.scale
  const tps = tpsOf(run, total, till - from)
  // 算出来不是个有限数就**不留成绩**——宁可让靶上继续挂着上一轮那个真数，
  // 也不要印一个 Infinity / NaN
  if (tps === undefined || !Number.isFinite(total)) return
  // **首字不可能早于开轮**，两个时刻都来自同一个 `performance.now()`。
  // 夹一道是因为这个数会被直接印到画面上：真出了负的（时钟被改、事件乱序、
  // 哪天有人拿 `event.at` 来调这条路——那是 `Date.now()` 系，差着一个纪元），
  // 靶上就会写出「-1787.32s → 87 tok/s」这种没人看得懂的东西。
  // 夹住之后最坏也只是显示 0.00s，那至少还是句人话
  run.done = { ttft: Math.max(0, (first - from) / 1000), tps, tokens: Math.round(total), exact }
}

/**
 * 生成速度：连着出字的那些时间里到手的量 ÷ 那些时间。真数在手时按估数的比例折过去。
 *
 * 一批就收工、或者全是隔得很远的零星几批时，出字时长攒不够：**退回端到端口径**（含 TTFT）
 * 而不是不给数——那种轮次「多久拿到这些字」本来就是唯一说得清的问题。
 */
function tpsOf(run: Run, total: number, span: number): number | undefined {
  if (run.flowMs >= MIN_FLOW_MS && run.flowEst > 0) {
    const tps = (total * (run.flowEst / run.est)) / (run.flowMs / 1000)
    return Number.isFinite(tps) ? tps : undefined
  }
  if (!(span > 0)) return undefined
  const tps = total / (span / 1000)
  return Number.isFinite(tps) ? tps : undefined
}

/** 用一轮真数修一次倍率。越界的样本直接丢，理由见 `SCALE_MIN`。 */
function learn(run: Run, sample: number): void {
  run.learned = true
  if (!(sample >= SCALE_MIN && sample <= SCALE_MAX)) return
  run.scale += (sample - run.scale) * LEARN
}

/**
 * 换会话：把账本清回出厂。
 *
 * **倍率也清**——它是跟着「哪家引擎、什么语言」学出来的，
 * 换条会话很可能就换了一家，带过去的话头几轮的估数会朝着上一家偏。
 */
export function clearRun(run: Run): void {
  Object.assign(run, createRun())
}
