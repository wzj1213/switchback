import type { Event, Item, ItemId, ThreadId, TurnId, TurnPace } from "@omni/protocol"
import { estimateTokens } from "./tokens.js"

/**
 * 一轮的出字节奏怎么量：首字延迟、tok/s、生成量。
 *
 * **宿主在事件的唯一出口上跑它**（`@omni/host` 的 `ctx.ts`），收工那一刻把结果挂到
 * `turn.completed` 上一起落盘——之后回放、分界线、靶上那行读的都是那一份。
 * 渲染层跑同一份代码只为了跑着时给一个现场读数（`livePace`）：两边吃的是同一串事件、
 * 同一个 `at`，所以跑完时对得上，不会出现「跑着时 58、跑完变 41」。
 *
 * ## 口径（和 DeepSeek Harness 的轮次页脚、各家评测的 Output Speed 同一个）
 *
 * - **首字**：这一轮开跑 → 模型第一次有输出（思考、正文，或者一条工具调用）。
 * - **速度** = 生成量 ÷ 出字时长。一轮里常常是好几次请求：模型写一段、调一次工具，
 *   工具跑完再发下一次请求、再等一遍首字。**工具在跑、下一次请求在等首字的那些空档不是在生成，不算**。
 * - **生成量**：引擎报了就用真数（claude、grok 在收工前报这一轮的总数）；
 *   没报的（kimi、codex、通用 ACP）按字符种类估（`tokens.ts`），界面带 ≈。
 *
 * ## 真数和估数，分母不一样——分子分母得数同一段输出
 *
 * - **真数**里有看不见的那部分：隐藏的推理、工具调用的参数（写文件时整份文件都在里面）。
 *   所以分母按**每次请求**算：从它第一次有看得见的字，到它收尾——下一条工具调用冒出来的那一刻
 *  （工具调用是参数写完才整条送来的），或者最后一个字。那段看不见的生成就在这里面。
 *   一个字没写就直接调工具的那次请求，从它发出去算起（开跑，或者上一个工具跑完）。
 * - **估数**只数得到看得见的字，分母就只算看得见的字在往外流的时间：两批字隔了超过
 *   `GAP_MS` 就算停了（它在想、或者在写看不见的参数），那段不算；每段的头一批也不算——
 *   它是在空档之后到的，花了多久没法量。
 *
 * 纯逻辑：不读时钟（时刻全来自事件的 `at`）、不碰 IO。账本原地改。
 */

/** 两批字之间隔多久就算停了。流式输出的两批之间通常是几十到几百毫秒。 */
export const GAP_MS = 1500

/** 出字时长攒到这么多才给速度：几百毫秒里的商只是噪声。 */
const MIN_MS = 400

/** 模型自己说的话。 */
const SPOKEN: ReadonlySet<string> = new Set(["agent_message", "reasoning"])

/** 工具调用到了这几种状态就是跑完了：下一次请求这时候发出去。 */
const SETTLED: ReadonlySet<string> = new Set(["ok", "failed", "denied", "interrupted"])

interface Run {
  thread: ThreadId
  from: number
  /** 模型第一次有输出的时刻。 */
  first: number | undefined
  /** 这一次请求什么时候发出去的：开跑、或者上一个工具跑完。工具在跑时是 undefined。 */
  sent: number | undefined
  /** 这一次请求第一次、最近一次有看得见的字的时刻。 */
  stepFrom: number | undefined
  stepLast: number | undefined
  /** 真数口径的出字时长：每次请求从它第一次有输出到收尾。 */
  spanMs: number
  /** 估数口径：看得见的字连着流的时长，和那段时间里到手的估数。 */
  flowMs: number
  flowEst: number
  /** 上一批字的时刻。插进一条不是说话的 item 就清掉，下一批另起一段。 */
  last: number | undefined
  /** 这一轮看得见的字一共估成多少 token。 */
  est: number
  /** 引擎报的生成量。 */
  reported: number | undefined
}

/** 说话的那几种 item：属于哪一轮、已经数过多少个字（`item.updated` 只数多出来的那截）。 */
interface Spoken {
  turn: TurnId
  seen: number
}

export interface PaceBook {
  runs: Map<TurnId, Run>
  spoken: Map<ItemId, Spoken>
  /** 每条会话此刻在跑哪一轮。用量事件只带会话，靠它找到那一轮。 */
  current: Map<ThreadId, TurnId>
}

export function createPaceBook(): PaceBook {
  return { runs: new Map(), spoken: new Map(), current: new Map() }
}

/**
 * 吃一条事件。**`turn.completed` 那一条返回这一轮的节奏**——模型一次输出都没有过
 * （比如一开跑就被停下、或者是抄过来的历史）就是 undefined；其余事件一律 undefined。
 */
export function notePace(book: PaceBook, event: Event): TurnPace | undefined {
  switch (event.type) {
    case "turn.started":
      startRun(book, event.turn.id, event.turn.threadId, event.at)
      return undefined
    case "turn.completed":
      return endRun(book, event.turnId)
    case "item.started":
      onStarted(book, event.item, event.at)
      return undefined
    case "item.updated":
      onUpdated(book, event.item, event.at)
      return undefined
    case "item.delta":
      onDelta(book, event.itemId, event.append, event.at)
      return undefined
    case "usage.updated":
      onUsage(book, event.threadId, event.usage.outputTokens)
      return undefined
    case "thread.removed":
      dropThread(book, event.threadId)
      return undefined
    default:
      return undefined
  }
}

/** 这条会话正在跑的那一轮此刻的读数。和收工时同一个算法，只是还没收尾。 */
export function livePace(book: PaceBook, thread: ThreadId): TurnPace | undefined {
  const turn = book.current.get(thread)
  const run = turn === undefined ? undefined : book.runs.get(turn)
  if (run === undefined) return undefined
  return paceOf(run, run.spanMs + openSpan(run))
}

function startRun(book: PaceBook, turn: TurnId, thread: ThreadId, at: number): void {
  // 一条会话同时只有一轮在跑：上一轮没等到收工（驱动崩了）的账这时候扔掉
  const prev = book.current.get(thread)
  if (prev !== undefined) dropRun(book, prev)
  book.runs.set(turn, {
    thread, from: at, first: undefined, sent: at, stepFrom: undefined, stepLast: undefined,
    spanMs: 0, flowMs: 0, flowEst: 0, last: undefined, est: 0, reported: undefined,
  })
  book.current.set(thread, turn)
}

function endRun(book: PaceBook, turn: TurnId): TurnPace | undefined {
  const run = book.runs.get(turn)
  if (run === undefined) return undefined
  closeStep(run)
  dropRun(book, turn)
  return paceOf(run, run.spanMs)
}

function spokenText(item: Item): string {
  return item.kind === "agent_message" || item.kind === "reasoning" ? item.text : ""
}

/**
 * 一条 item 开了头。抄过来的历史（`inherited`）和旁路（子 agent、侧问）不算：
 * 前者不是这一轮生成的，后者是**另一个 agent 在同时写**，混进来速度会翻倍。
 */
function onStarted(book: PaceBook, item: Item, at: number): void {
  const run = book.runs.get(item.turnId)
  if (run === undefined || item.inherited === true || item.lane !== undefined) return
  if (SPOKEN.has(item.kind)) {
    const text = spokenText(item)
    book.spoken.set(item.id, { turn: item.turnId, seen: text.length })
    speak(run, at, estimateTokens(text))
    return
  }
  if (item.kind === "tool_call") call(run, at)
  // 计划是模型调的一个工具（codex 的 update_plan、claude 的待办），而且当场就「跑完」了
  else if (item.kind === "plan") plan(run, at)
  else {
    // 审批、提示、报错：这一次请求到它最后一个字为止。
    // 报错之后引擎多半会重试，下一次请求从现在发出去
    closeStep(run)
    if (item.kind === "error") run.sent = at
  }
}

/** 一条 item 整条更新了。说话的那几种只数多出来的那截；工具跑完了记下一次请求的发出时刻。 */
function onUpdated(book: PaceBook, item: Item, at: number): void {
  const entry = book.spoken.get(item.id)
  if (entry !== undefined) {
    grow(book, entry, spokenText(item), at)
    return
  }
  const run = book.runs.get(item.turnId)
  if (run === undefined || item.lane !== undefined) return
  if (item.kind === "plan") plan(run, at)
  else if (item.kind === "tool_call" && SETTLED.has(item.status)) run.sent = at
}

function grow(book: PaceBook, entry: Spoken, text: string, at: number): void {
  if (text.length <= entry.seen) return
  const fresh = text.slice(entry.seen)
  entry.seen = text.length
  const run = book.runs.get(entry.turn)
  if (run !== undefined) speak(run, at, estimateTokens(fresh))
}

function onDelta(book: PaceBook, itemId: ItemId, append: string, at: number): void {
  const entry = book.spoken.get(itemId)
  if (entry === undefined) return
  entry.seen += append.length
  const run = book.runs.get(entry.turn)
  if (run !== undefined) speak(run, at, estimateTokens(append))
}

/** 引擎报了生成量。**取最后一次报的**：一轮里可能报好几次，越后面越全。 */
function onUsage(book: PaceBook, thread: ThreadId, out: number | undefined): void {
  if (out === undefined || !(out > 0)) return
  const turn = book.current.get(thread)
  const run = turn === undefined ? undefined : book.runs.get(turn)
  if (run !== undefined) run.reported = out
}

/** 到了一批看得见的字（`est` 是估出来的 token）。 */
function speak(run: Run, at: number, est: number): void {
  if (est <= 0) return
  run.first ??= at
  run.stepFrom ??= at
  run.stepLast = at
  if (run.last !== undefined && at - run.last <= GAP_MS) {
    run.flowMs += Math.max(0, at - run.last)
    run.flowEst += est
  }
  run.last = at
  run.est += est
}

/** 冒出来一条工具调用：这一次请求到这儿写完了。 */
function call(run: Run, at: number): void {
  run.first ??= at
  const from = run.stepFrom ?? run.sent
  if (from !== undefined) run.spanMs += Math.max(0, at - from)
  run.stepFrom = undefined
  run.stepLast = undefined
  run.sent = undefined
  run.last = undefined
}

/** 计划：一次调用，而且当场跑完，下一次请求紧接着就发。 */
function plan(run: Run, at: number): void {
  call(run, at)
  run.sent = at
}

/** 这一次请求到它最后一个字为止。 */
function closeStep(run: Run): void {
  run.spanMs += openSpan(run)
  run.stepFrom = undefined
  run.stepLast = undefined
  run.last = undefined
}

function openSpan(run: Run): number {
  return run.stepFrom === undefined || run.stepLast === undefined ? 0 : Math.max(0, run.stepLast - run.stepFrom)
}

function paceOf(run: Run, spanMs: number): TurnPace | undefined {
  if (run.first === undefined) return undefined
  const exact = run.reported !== undefined
  const tps = run.reported === undefined ? rate(run.flowEst, run.flowMs) : rate(run.reported, spanMs)
  return {
    firstMs: Math.max(0, run.first - run.from),
    tokens: run.reported ?? Math.round(run.est),
    exact,
    ...(tps === undefined ? {} : { tps }),
  }
}

function rate(tokens: number, ms: number): number | undefined {
  if (!(ms >= MIN_MS) || !(tokens > 0)) return undefined
  const tps = tokens / (ms / 1000)
  return Number.isFinite(tps) ? tps : undefined
}

function dropRun(book: PaceBook, turn: TurnId): void {
  const run = book.runs.get(turn)
  book.runs.delete(turn)
  if (run !== undefined && book.current.get(run.thread) === turn) book.current.delete(run.thread)
  for (const [id, entry] of book.spoken) if (entry.turn === turn) book.spoken.delete(id)
}

function dropThread(book: PaceBook, thread: ThreadId): void {
  const turn = book.current.get(thread)
  if (turn !== undefined) dropRun(book, turn)
}
