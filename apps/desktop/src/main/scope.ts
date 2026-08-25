import type { EngineInfo, Event, Thread, ThreadId } from "@omni/protocol"
import type { ThreadHistory } from "./host.js"

/**
 * 一份全量里带多少正文。
 *
 * ## 为什么要分级
 *
 * `rebuild` 拼的是**所有会话的完整历史**。同机 IPC 上无所谓；对着蜂窝网就不行了。
 *
 * ## 判据必须是字节，不是条数
 *
 * 这里第一版卡的是**事件条数**（4000 条），而那是错的。实测这台机器上
 * 九条会话一共 3291 条事件——低于 4000，于是九条全带正文，
 * **合起来 5,221,529 字节**：其中两条各 1549 条事件、各 2.5 MB，
 * 是被工具输出撑起来的。条数看着小，字节大两个数量级。
 *
 * 后果不是「慢一点」而是**什么都看不到**：那一份要切成 271 个分片，
 * 而客户端必须收齐才能重组出一帧。手机上收不完就是一片空白；
 * 而没收完就没有游标，于是重连从头再来——**一个死循环**。
 * 真机上复现过：配对成功、连上 5 次、一条会话都没显示。
 *
 * ## 分级怎么分
 *
 * 会话的**头**（`thread.started` / `thread.updated` / `thread.renamed`）一条不少
 *——列表要靠它画。**正文**按「最近写过的优先」给一个字节预算，超出的只发头，
 * 等客户端真的打开那一条时再单独要（`watch` → `thread` 帧）。
 *
 * 还有一层：**单条会话自己也封顶**。「第一条永远带正文」这条规则配上一条
 * 2.5 MB 的会话，等于预算形同虚设。超了就只带**尾巴**——你回头找的是刚才那几句，
 * 不是三小时前那句。
 *
 * 判据是「最近写过的」而不是「最近创建的」：`journal.list()` 本来就按前者排，
 * 而人回头找的也是「刚才在弄的那条」。
 */

/**
 * 一份全量里，所有正文加起来的上限。
 *
 * **单位是 UTF-16 码元，不是字节**——分片切的就是码元
 *（`@omni/wire` 的 `segment.ts`，一片 16,384 个），所以这个数直接换算成
 * 「切成几片」，而片数才是手机上那段空白的长短。名字上别写「字节」骗人：
 * 中文一个字是 1 个码元、3 个字节，两者差三倍。
 *
 * 192K 码元 ≈ 12 片。**别往大了调。**
 */
export const REMOTE_REPLAY_CHARS = 192 * 1024

/**
 * 单条会话的正文上限，全量和单独补（`watch` → `thread`）都用它。
 *
 * 64K 码元 ≈ 4 片，大概几十轮正常对话。超了只带尾巴：你回头找的是刚才那几句。
 */
export const REMOTE_THREAD_CHARS = 64 * 1024

export interface Scoped {
  /** 这些会话的正文进这一份全量（可能是**裁过的尾巴**，见 `bodyOf`）。其余只发头。 */
  bodies: ReadonlySet<ThreadId>
  /** 因为预算被留下的会话数。写日志用——**省了多少要说得出来**。 */
  deferred: number
  /** 正文被裁掉过头的会话数。**要让人知道**：看不见开头而没有任何提示，比空白更糟。 */
  trimmed: number
  /** 具体是哪几条被裁了。客户端拿它画「更早的内容没有加载」。 */
  trimmedIds: ReadonlySet<ThreadId>
}

/** 一条事件在线上占多少码元。`JSON.stringify` 一次，别猜。 */
const sizeOf = (event: Event): number => JSON.stringify(event).length

/**
 * 一条会话的正文，**按码元封顶**。超了就丢开头、留尾巴，但**头一条不丢**
 *（`thread.started` 那些——丢了这条会话在归约器里就无处安放）。
 */
export function bodyOf(thread: ThreadHistory, cap: number): { events: readonly Event[]; trimmed: boolean } {
  const head = headerOf(thread)
  const rest = thread.events.filter((e) => !BASE.has(e.type) && !PATCH.has(e.type))
  const kept: Event[] = []
  let spent = head.reduce((n, e) => n + sizeOf(e), 0)
  // 从**尾巴**往回收：最近说的那几句最要紧
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const one = rest[i]
    if (one === undefined) continue
    const cost = sizeOf(one)
    if (spent + cost > cap) return { events: [...head, ...kept], trimmed: true }
    spent += cost
    kept.unshift(one)
  }
  return { events: thread.events, trimmed: false }
}

/**
 * 按预算挑哪些会话带正文。
 *
 * @param threads 磁盘上的历史，**最近写过的在前**（`journal.list()` 的顺序）。
 * @param budget 正文的总**码元**上限。`undefined` = 不限（桌面窗口那条路）。
 */
export function scopeReplay(threads: readonly ThreadHistory[], budget?: number): Scoped {
  if (budget === undefined) {
    return { bodies: new Set(threads.map((t) => t.id)), deferred: 0, trimmed: 0, trimmedIds: new Set() }
  }
  const bodies = new Set<ThreadId>()
  const trimmedIds = new Set<ThreadId>()
  let spent = 0
  let deferred = 0
  let trimmed = 0
  for (const thread of threads) {
    const body = bodyOf(thread, REMOTE_THREAD_CHARS)
    const cost = body.events.reduce((n, e) => n + sizeOf(e), 0)
    // **第一条永远带正文**，哪怕它自己就超了预算：一个连正文都没有的
    // 「最近那条」是这一端最没用的状态——你打开它看到的是空白。
    // 它现在也封了顶（`bodyOf`），所以这条规则不再能把预算整个架空
    if (bodies.size === 0 || spent + cost <= budget) {
      bodies.add(thread.id)
      spent += cost
      if (body.trimmed) {
        trimmed += 1
        trimmedIds.add(thread.id)
      }
      continue
    }
    deferred += 1
  }
  return { bodies, deferred, trimmed, trimmedIds }
}

/** 一条会话的「头」都有哪些事件：能凭空造出这一行、或者改这一行的那些。 */
const BASE = new Set(["thread.started", "thread.updated"])
const PATCH = new Set(["thread.renamed", "thread.removed"])

/**
 * 历史投影背后没人等答案；把落盘时尚未落定的瞬时卡一起清掉。
 *
 * `updatedAt` 必须保留原值：它说的是「这条会话最后一次真的变动」，不是
 * 「这份投影什么时候重建」。拿重建时刻覆盖它，会让每次启动后所有历史都变成
 * “刚刚”，侧栏既失去时间，也失去按最近使用排序的依据。
 */
function detachedThread(thread: Thread): Thread {
  const detached = { ...thread, status: "idle" as const, detached: true }
  delete detached.pendingQuestions
  return detached
}

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
  return [...events, { type: "thread.updated", at: now, thread: detachedThread(last.thread) }]
}

/**
 * 这条会话在一份全量里出多少：整份 / 裁过的尾巴 / 只发头。
 *
 * 住在这里而不是 `host.ts`：它和 `headerOf` / `bodyOf` 是同一件事的三个档，
 * 分开放的话改一个忘一个。
 */
export function partOf(thread: ThreadHistory, bodies: ReadonlySet<ThreadId>, cap?: number): readonly Event[] {
  if (!bodies.has(thread.id)) return headerOf(thread)
  return cap === undefined ? thread.events : bodyOf(thread, cap).events
}

/**
 * 把「历史 + 活着的会话 + 引擎清单」拼成一份全量。
 *
 * 单独一个纯函数是因为顺序在这里**是正确性问题**，而它不该只能靠起 Electron 来验。
 *
 * ## 为什么要反着喂
 *
 * `journal.list()` 给的是**最近写过的在前**（那是一个列表 API 该有的样子），
 * 而归约器 `reduce.ts` 是 `order: [id, ...order]`——**往前插**。
 * 顺着喂，最新的那个会被后来的旧会话一路顶到底下，侧栏变成最旧在前。
 *
 * 这个 bug 一直都在，只是以前看不见：启动时最后总会新建一个会话，
 * 它往前一插就盖住了顺序不对这件事。重载时不新建会话，才露出来。
 */
export interface ReplayInput {
  engines: readonly EngineInfo[]
  /** 磁盘上的历史，最近写过的在前。 */
  threads: readonly ThreadHistory[]
  alive: ReadonlyMap<ThreadId, Thread>
  now: number
  /**
   * 哪些会话带正文。不给 = 全带（桌面窗口那条路，同机 IPC 不心疼）。
   * 远程那条给一个预算，超出的只发头——见 `scope.ts`。
   */
  bodies?: ReadonlySet<ThreadId>
  /** 单条正文的码元上限。跟 `bodies` 成对出现（只有远程那条路给）。 */
  cap?: number
}

/** 旧版本可能落过瞬时横幅；历史全量不重放，重建期间的 live 增量则不走这里。 */
function historicalContent(events: readonly Event[]): readonly Event[] {
  return events.filter((event) =>
    event.type !== "engine.status" && event.type !== "engine.notification")
}

export function replayEvents({ engines, threads, alive, now, bodies, cap }: ReplayInput): readonly Event[] {
  const events: Event[] = [{ type: "engines.available", at: now, engines }]
  // 反着喂：归约器往前插，所以最旧的先进去，最新的才会落在侧栏顶上
  for (const thread of [...threads].reverse()) {
    if (thread.events.length === 0) continue
    // **一句话都没说过的会话不算历史。**
    //
    // omni 每次启动都会开一个默认会话，用不用它是另一回事——于是每启动一次
    // 侧栏就多一行「新会话」。跑一周下来那一列全是空壳，把真正的历史挤没了。
    //
    // 这种会话也确实没有可续的东西：续跑要靠引擎侧的句柄接上一段对话，
    // 而它压根没有对话。活着的那个例外——它正开着，用户随时会在里面打字。
    if (alive.get(thread.id) === undefined && !thread.events.some((e) => e.type === "item.started" && e.item.kind === "user_message")) {
      continue
    }
    // 带正文的也可能是**裁过的尾巴**：一条 2.5 MB 的会话足以把整份预算架空
    const content = bodies === undefined ? thread.events : partOf(thread, bodies, cap)
    events.push(...historicalContent(content))
    const live = alive.get(thread.id)
    if (live !== undefined) {
      // 用宿主手上那份当前状态收尾：journal 里最后一条可能停在轮次中间
      events.push({ type: "thread.updated", at: now, thread: live })
      continue
    }
    const last = [...thread.events]
      .reverse()
      .find((e) => e.type === "thread.started" || e.type === "thread.updated")
    if (last === undefined || (last.type !== "thread.started" && last.type !== "thread.updated")) continue
    // 回放出来的会话背后没有引擎进程，补一条 `detached` 让界面关掉输入框——
    // 一个能打字却答非所问的输入框比没有输入框糟得多
    events.push({ type: "thread.updated", at: now, thread: detachedThread(last.thread) })
  }
  events.push(...unlogged(threads, alive, now))
  return events
}

/**
 * **活着、但磁盘上一个字都没有的会话**——也就是临时会话（见 `Thread.provisional`）。
 *
 * 它不落盘是有意的（`Ctx.uncommitted`），代价是这份全量拼不出它：全量是从
 * journal 拼的。不补的话，⌘R 之后那个临时窗口整个消失，而它背后的引擎进程
 * 还活着——`rebuild` 甚至会把它的 id 当成「重载后该选中的那个」返回，
 * 于是界面落在一条它自己都不知道存在的会话上。
 *
 * 排在最后：归约器往前插，所以最后进去的落在侧栏最上面——临时会话本来就是
 * 你正在用的那个。（它不会真的出现在侧栏里，那是渲染层按 `provisional` 过滤的。）
 */
function unlogged(
  threads: readonly ThreadHistory[],
  alive: ReadonlyMap<ThreadId, Thread>,
  now: number,
): readonly Event[] {
  const logged = new Set(threads.filter((t) => t.events.length > 0).map((t) => t.id))
  return [...alive.values()]
    .filter((thread) => !logged.has(thread.id))
    .map((thread) => ({ type: "thread.started" as const, at: now, thread }))
}
