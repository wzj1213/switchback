import type { Event, ItemId, ThreadId, TurnId } from "@switchback/protocol"
import type { Sealed } from "@switchback/wire"
import { estimateTokens, notePace, type PaceBook } from "@switchback/store"
import { mark, type Meter } from "./throughput.js"
import { pushText, type TapeText } from "./tape-text.js"

/**
 * 「这条 delta 是不是**这一条会话**吐出来的」。
 *
 * ## 为什么需要它
 *
 * `item.delta` 上只有 `itemId`——没有会话、没有轮次。而后台还可能有别的会话在跑，
 * 照单全收的话，你盯着的这只桌宠会为**另一条会话**的输出开火。
 * 那比不开火更糟：画面在说一件没在这儿发生的事。
 *
 * 身份要走两跳补回来：`turn.started` 带整个 `Turn`（有 `threadId`），
 * `item.started` 带 `turnId`。于是
 * **threadId → turnId → itemId**，每一跳都由宿主自己发的事件给，
 * 这里不猜、不推断、不查 store。
 *
 * ## 只跟当前那一轮
 *
 * 流速回答的是「此刻」，而「此刻」最多属于一轮。所以换轮就清空——
 * 顺带这也是它不会无限长大的原因：集合里最多装得下一轮里的 item。
 *
 * ## 只认**模型自己说的话**
 *
 * 上一版把这一轮里**每一条** item 的 delta 都记进去，而工具的输出也走
 * `item.delta`（codex 的 `onOutputDelta` 就是）。于是跑一次 `pnpm build`
 * 刷出上万行，桌宠会当成模型在狂吐字：**t/s 飙上天、枪打成加特林，
 * 而模型此刻一个 token 都没生成**。那不是读数偏差，是在画一件没发生的事。
 *
 * 现在只收 `SPOKEN` 那几种。挑这几种还有第二个理由：业界那个 token/s 的分子是
 * `output_tokens`，而**推理 token 是算在 output 里的**——所以 `reasoning` 必须收。
 *
 * 这一轮的 tok/s 不在这儿算：那是 `@switchback/store` 的 `pace.ts`，宿主和这里跑的是同一份。
 *
 * 纯逻辑：不读时钟、不碰 DOM、不订阅任何东西。
 */
export interface Scope {
  thread: ThreadId | undefined
  /** 当前这条会话最近开的那一轮。 */
  turn: TurnId | undefined
  /** 那一轮里的 item。**只装当前轮**，换轮就清。 */
  items: Set<ItemId>
}

/**
 * 集合的上限。
 *
 * 一轮里的 item 通常几十条；这道闸是给病态情况留的
 *（一个引擎把每个字都报成一条新 item），**它宁可少算也不能无限长大**。
 */
const MAX_ITEMS = 512

export function createScope(): Scope {
  return { thread: undefined, turn: undefined, items: new Set() }
}

/** 换会话。**必须清**：上一条会话的轮次和 item 不属于这一条。 */
export function retarget(scope: Scope, thread: ThreadId | undefined): void {
  if (scope.thread === thread) return
  scope.thread = thread
  scope.turn = undefined
  scope.items.clear()
}

/**
 * 哪几种 item 算「模型自己说的话」。
 *
 * `tool_call` 不在里面——那是它**用了个工具**，工具吐回来的东西不是它写的。
 * `user_message` / `approval` / `error` 同理，那些根本不是模型产的。
 *
 * 有一处它天然收不全，而且**只能记下来不能补**：工具调用的参数（那串 JSON）
 * 也算模型的 output token，但它不以 `item.delta` 的形式过来。于是这里的估数
 * 相对真 token 数**系统性偏少**。开火节奏只要「此刻在不在写、写得多密」，偏少不要紧；
 * 要紧的那个数（一轮的 tok/s）按真数和估数分开量，见 `pace.ts`。
 */
const SPOKEN: ReadonlySet<string> = new Set(["agent_message", "reasoning"])

/** 一条事件对滑窗和纸带意味着什么：要么没事，要么是这条会话里模型刚写出来的一段字。 */
export type Beat = { kind: "idle" } | { kind: "text"; tokens: number; text: string }

const IDLE: Beat = { kind: "idle" }

/** 吃一条事件。不属于当前会话的一律 `idle`。 */
export function absorb(scope: Scope, event: Event): Beat {
  if (event.type === "turn.started") {
    if (event.turn.threadId !== scope.thread) return IDLE
    scope.turn = event.turn.id
    scope.items.clear()
    return IDLE
  }
  if (event.type === "turn.completed") {
    if (scope.turn === undefined || event.turnId !== scope.turn) return IDLE
    scope.turn = undefined
    scope.items.clear()
    return IDLE
  }
  return onItem(scope, event)
}

/** item 那两条。拆出来是圈复杂度闸门逼的，边界也顺：上面管轮次，这里管 item。 */
function onItem(scope: Scope, event: Event): Beat {
  if (event.type === "item.started") {
    const mine = scope.turn !== undefined && event.item.turnId === scope.turn
    if (mine && SPOKEN.has(event.item.kind) && scope.items.size < MAX_ITEMS) scope.items.add(event.item.id)
    return IDLE
  }
  if (event.type !== "item.delta") return IDLE
  if (!scope.items.has(event.itemId)) return IDLE
  return { kind: "text", tokens: estimateTokens(event.append), text: event.append }
}

/**
 * 吃一批事件：把（估出来的）token 记进滑窗，把字交给纸带，把每一条都交给节奏账本。
 *
 * 抽出来是为了**它能被测**：留在 hook 里的话，这几行——「一批一次、
 * 一个字都没有就别记、滑窗用收到的时刻」——就只能靠肉眼保证，
 * 而它们恰恰是整条链上最容易错的地方（照仓库里 `usePetMood` 的老规矩：
 * 逻辑抽出来测，hook 只剩订阅）。
 *
 * **滑窗一批只记一笔**：主进程已经合过帧（`main/batch.ts`），
 * 这里再逐条记等于把一次网络往返拆成十几个样本，滑窗会被同一批字撑出假的峰值。
 * **节奏账本则要逐条按顺序走**，而且用事件自己的 `at`：它和宿主跑的是同一份算法，
 * 跑完时两边的数才对得上。它**不看是哪条会话**——账本自己按会话分，谁在看由读的人决定。
 */
export function drain(
  scope: Scope,
  into: { meter: Meter; book: PaceBook; tape?: TapeText },
  sealed: readonly Sealed[],
  now: number,
): void {
  let tokens = 0
  for (const one of sealed) {
    notePace(into.book, one.event)
    const beat = absorb(scope, one.event)
    if (beat.kind !== "text") continue
    tokens += beat.tokens
    if (into.tape !== undefined) pushText(into.tape, beat.text)
  }
  if (tokens > 0) mark(into.meter, now, tokens)
}
