import type { Event, Thread, ThreadId } from "@omni/protocol"
import type { ThreadHistory } from "./host.js"

/**
 * 一份全量里带多少正文。
 *
 * ## 为什么要分级
 *
 * `rebuild` 拼的是**所有会话的完整历史**。同机 IPC 上无所谓；对着蜂窝网就不行了
 * ——实测这台机器上一份重建出来的帧是 4,358,625 个码元，而它现在
 * **每次手机重连都要发一遍**。用户看到的是「正在连接…」转十几秒，
 * 而那期间他要的只是看一眼有没有东西在等他确认。
 *
 * ## 分级怎么分
 *
 * 会话的**头**（`thread.started` / `thread.updated`）一条不少——列表要靠它画。
 * **正文**按「最近写过的优先」给一个预算，超出的会话只发头，
 * 等客户端真的打开那一条时再单独要（`watch` → `thread` 帧）。
 *
 * 判据是「最近写过的」而不是「最近创建的」：`journal.list()` 本来就按前者排，
 * 而人回头找的也是「刚才在弄的那条」。
 */

/** 远程客户端默认带多少条正文。约等于三四条正常会话，一份 replay 落在几百 KB。 */
export const REMOTE_ITEM_BUDGET = 4000

export interface Scoped {
  /** 这些会话的正文进这一份全量。其余只发头。 */
  bodies: ReadonlySet<ThreadId>
  /** 因为预算被留下的会话数。写日志用——**省了多少要说得出来**。 */
  deferred: number
}

/**
 * 按预算挑哪些会话带正文。
 *
 * @param threads 磁盘上的历史，**最近写过的在前**（`journal.list()` 的顺序）。
 * @param budget 正文的总事件数上限。`undefined` = 不限（桌面窗口那条路）。
 */
export function scopeReplay(threads: readonly ThreadHistory[], budget?: number): Scoped {
  if (budget === undefined) return { bodies: new Set(threads.map((t) => t.id)), deferred: 0 }
  const bodies = new Set<ThreadId>()
  let spent = 0
  let deferred = 0
  for (const thread of threads) {
    // **第一条永远带正文**，哪怕它自己就超了预算：一个连正文都没有的
    // 「最近那条」是这一端最没用的状态——你打开它看到的是空白
    if (bodies.size === 0 || spent + thread.events.length <= budget) {
      bodies.add(thread.id)
      spent += thread.events.length
      continue
    }
    deferred += 1
  }
  return { bodies, deferred }
}

/** 一条会话的「头」都有哪些事件：能凭空造出这一行、或者改这一行的那些。 */
const BASE = new Set(["thread.started", "thread.updated"])
const PATCH = new Set(["thread.renamed", "thread.removed"])

/**
 * 一条会话只发头。
 *
 * 基底是最后那一条 `thread.started` / `thread.updated`——列表要靠它画出
 * 标题、状态、引擎。**不是发空数组**：找不到基底（那条记录里压根没有 thread 事件）
 * 就什么都不发，让它在列表里干脆不出现，而不是出现一行没有名字的空壳。
 *
 * **基底之后的改动要跟着走。** 改名走的是 `thread.renamed`（只带 id 和标题，
 * 不带整个 `Thread`），它不会更新基底那一份快照——只发基底的话，
 * 一条改过名的会话在手机上显示的是**旧标题**，而你在桌面上明明改过了。
 * 这类「看起来正常、内容是错的」比空白更难发现。
 */
export function headerOf(thread: ThreadHistory): readonly Event[] {
  const at = thread.events.findLastIndex((e) => BASE.has(e.type))
  if (at === -1) return []
  const base = thread.events[at]
  if (base === undefined) return []
  return [base, ...thread.events.slice(at + 1).filter((e) => PATCH.has(e.type))]
}

/**
 * 单独补一条会话的正文时，**结尾要拿宿主手上那份当前状态收口**。
 *
 * 磁盘上那份是「上次落盘时的样子」，而客户端拿到它之后会照着重建这条会话——
 * 于是一条正在跑的会话会被改回 `idle`，一条已经改过名的会显示旧标题。
 * 界面看起来完全正常，只是内容是旧的，这比空白难发现得多。
 *
 * 规则和全量那条路（`replayEvents`）是同一条，故意长得一样：
 * 活着的就补它的当前记录；不活着的补一条 `detached`，让界面关掉输入框——
 * **一个能打字却答非所问的输入框比没有输入框糟得多**。
 */
export function withCurrent(events: readonly Event[], live: Thread | undefined, now: number): readonly Event[] {
  if (events.length === 0) return events
  if (live !== undefined) return [...events, { type: "thread.updated", at: now, thread: live }]
  const last = [...events].reverse().find((e) => e.type === "thread.started" || e.type === "thread.updated")
  if (last === undefined) return events
  return [...events, { type: "thread.updated", at: now, thread: { ...last.thread, status: "idle", detached: true } }]
}
