import type { Event, ItemId, ThreadId, TurnId } from "@omni/protocol"

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
 * 吃一条事件，返回**这条事件贡献了多少字节**（不属于当前会话就是 0）。
 *
 * 返回字节而不是布尔，是为了让调用方一句话就能接上流速表：
 * 判断「算不算」和「算多少」本来就是同一次遍历里的事。
 */
export function absorb(scope: Scope, event: Event): number {
  if (event.type === "turn.started") {
    if (event.turn.threadId !== scope.thread) return 0
    scope.turn = event.turn.id
    scope.items.clear()
    return 0
  }
  if (event.type === "item.started") {
    if (scope.turn !== undefined && event.item.turnId === scope.turn && scope.items.size < MAX_ITEMS) {
      scope.items.add(event.item.id)
    }
    return 0
  }
  if (event.type !== "item.delta") return 0
  return scope.items.has(event.itemId) ? byteLength(event.append) : 0
}

/**
 * UTF-8 字节数。
 *
 * 不能用 `str.length`：那是 UTF-16 码元数，中文一个字算 1、英文一个字母也算 1，
 * 于是**同一段内容中文会被当成英文的三分之一**。流速要比的是各家吐得多快，
 * 而它们的语言分布完全不同。
 *
 * 手算而不是 `TextEncoder`：这条路在吐字最快时每秒要走几十次，
 * 每次 `new TextEncoder().encode()` 会分配一整个 `Uint8Array`。
 */
export function byteLength(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i++ // 代理对：两个码元一个字符
    } else n += 3
  }
  return n
}
