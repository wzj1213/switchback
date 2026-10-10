import type { Command, Event, Thread, ThreadId } from "@switchback/protocol"
import { emit, resting, type Ctx, type Live } from "./ctx.js"
import { rememberHandle } from "./engine-state.js"
import { launch } from "./session.js"
import { latestSegment, switched } from "./switched.js"

/**
 * 把一条**历史会话**（宿主手上没有它，背后没有引擎进程）接回引擎。
 *
 * ## 为什么不再要人先点「继续」
 *
 * 上一版历史会话是只读的：输入框锁着，换引擎的下拉也锁着，只剩一颗「继续这个会话」，
 * 而它只会用**原来那一家**接回去。那一家一旦被删掉（ACP 条目从 engines.json 里摘了）
 * 或者起不来，这条会话就成了死路——接不回，又换不了。
 *
 * 现在接回发生在**发出下一句话的时候**（`prompt.ts`）：原来那家还在、留着句柄，
 * 就续上它自己那条原生会话；在历史会话上挑过别家（`nextEngine`），就直接起那一家，
 * 和活会话换引擎是同一套（`switched.ts`）。挑引擎、改档位都只改记录，不起进程。
 *
 * ## 接不回来的时候
 *
 * 先把会话还原成历史记录，再把错误抛出去由横幅说明。发话那条路还要把那句话
 * 原样退回输入框（`restore`）：输入框在按下发送时就清空了，不退回就是丢了一句话。
 */

type ThreadRecord = Extract<Event, { type: "thread.started" | "thread.updated" }>

const isRecord = (event: Event): event is ThreadRecord =>
  event.type === "thread.started" || event.type === "thread.updated"

/** 发话失败时要退回输入框的那句话。 */
export interface Restore {
  text: string
  attachments?: readonly string[]
}

/**
 * 一条历史会话**最后的样子**：journal 里最后那份 `Thread`，再叠上它之后的改名。
 *
 * 改名只发 `thread.renamed`（历史会话不在宿主手上，发不出整份快照），不叠的话，
 * 一条在历史状态下改过名的会话一接回来就变回旧名字。
 */
export async function recordOf(ctx: Ctx, threadId: ThreadId): Promise<Thread | undefined> {
  return (await historyOf(ctx, threadId))?.thread
}

/** 历史会话最后的样子，外加哪几家在这条会话里真跑过轮次（`turn.started` 记着是谁跑的）。 */
async function historyOf(
  ctx: Ctx,
  threadId: ThreadId,
): Promise<{ thread: Thread; ran: ReadonlySet<string> } | undefined> {
  // 事件出口不等落盘；刚发生的改名、改档要先落完再读
  await ctx.deps.journal?.flush()
  const events = (await ctx.deps.journal?.read(threadId)) ?? []
  const at = events.findLastIndex(isRecord)
  const base = events[at]
  if (base === undefined || !isRecord(base)) return undefined
  let thread = base.thread
  for (const event of events.slice(at + 1)) {
    if (event.type === "thread.renamed") thread = { ...thread, title: event.title, named: true }
  }
  const ran = new Set(events.flatMap((event) => (event.type === "turn.started" ? [event.turn.engine] : [])))
  return { thread, ran }
}

/** 宿主手上没有的会话：没有进程，也没有谁在等它那几张卡。和桌面端重建全量时补的那条同一个口径。 */
function historic(thread: Thread, at: number): Thread {
  const next: Thread = { ...thread, detached: true, status: resting(thread.status), updatedAt: at }
  delete next.pendingQuestions
  delete next.pendingApprovals
  return next
}

/**
 * 改一条历史会话的记录（档位、下一句用哪家），整份重发、落盘，下次接回时照新的来。
 *
 * **必须带上 `detached`**：归约器拿 `thread.updated` 整份替换，journal 里那份快照
 * 常常是活着时落的、没有这个标记，原样发出去界面就会把它当成活会话。
 */
export async function updateRecord(
  ctx: Ctx,
  threadId: ThreadId,
  patch: (thread: Thread) => Thread,
): Promise<void> {
  const record = await recordOf(ctx, threadId)
  // 读盘期间被删掉的不能再写一条，那会把刚删的文件建回来
  if (record === undefined || ctx.removed.has(threadId) || ctx.live.has(threadId)) return
  const next = patch(record)
  // 没改什么（比如取回的下标已经越界）就不重写一遍
  if (next === record) return
  const at = ctx.deps.now()
  emit(ctx, { type: "thread.updated", at, thread: historic(next, at) })
}

/**
 * 历史会话上挑引擎：只记意向，下一句话接回时兑现。
 *
 * 选回原来那家就是取消——**那家被删了也让取消**：挑了别家又反悔，不该撞上一句「未注册的引擎」。
 */
export function retarget(ctx: Ctx, threadId: ThreadId, to: string): Promise<void> {
  return updateRecord(ctx, threadId, (thread) => {
    if (to !== thread.engine && ctx.deps.drivers[to] === undefined) throw new Error(`未注册的引擎：${to}`)
    const next = { ...thread }
    if (to === thread.engine) delete next.nextEngine
    else next.nextEngine = to
    return next
  })
}

function goneMessage(engine: string): string {
  return `原来的引擎 ${engine} 已经不在了。在输入框下面换一家引擎，再发一次就能接着做。`
}

function lostMessage(engine: string): string {
  return `这条会话没有留下 ${engine} 的会话句柄（可能是旧版本记录），接不回原来的上下文。` +
    "在输入框下面换一家引擎就能接着做。"
}

/**
 * 接回之后它长什么样。接不回就在这里抛，**一个进程都不起**。
 *
 * - 记着要换的那家（`nextEngine`）：按换引擎的规矩起那一家，那一家以前跑过这条会话的，
 *   续它自己那一段（`latestSegment`）
 * - 没换：续原来那家。**跑过轮次却没留下句柄就不续**——起一个全新的原生会话却看着像接上了，
 *   是最坏的结果；换一家是明确的动作，不算冒充。一轮都没跑过的（换过来还没开口就停了，
 *   Claude 要等开轮之后才报句柄）没有上下文可冒充，新起一条就是准确结果
 */
function reattached(ctx: Ctx, record: Thread, at: number, ran: ReadonlySet<string>): Thread {
  const to = record.nextEngine ?? record.engine
  if (ctx.deps.drivers[to] === undefined) throw new Error(goneMessage(to))
  if (to !== record.engine) {
    const next = switched(record, to, latestSegment(record, to), { at, status: "idle" })
    delete next.pendingQuestions
  delete next.pendingApprovals
    return { ...next, detached: false }
  }
  if (record.engineHandle === undefined && ran.has(to)) throw new Error(lostMessage(to))
  const next: Thread = { ...record, detached: false, status: "idle", updatedAt: at }
  delete next.nextEngine
  delete next.pendingQuestions
  delete next.pendingApprovals
  return next
}

/** 没接上：还原成历史记录；发话那条路顺带把那句话退回输入框。 */
function giveBack(ctx: Ctx, record: Thread, restore: Restore | undefined): void {
  if (ctx.closed || ctx.removed.has(record.id)) return
  const at = ctx.deps.now()
  const thread = historic(record, at)
  if (restore !== undefined) {
    thread.draft = restore.text
    delete thread.draftAttachments
    if ((restore.attachments ?? []).length > 0) thread.draftAttachments = restore.attachments
    // 新身份：输入区认身份决定要不要再填一次（见渲染层 `useDraft`）
    thread.draftRevision = ctx.deps.newId("dr")
  }
  emit(ctx, { type: "thread.updated", at, thread })
}

async function attach(ctx: Ctx, record: Thread, thread: Thread, restore: Restore | undefined): Promise<Live> {
  // 起进程要几百毫秒到几秒；先让界面知道在接，输入区据此暂时不收第二句
  emit(ctx, { type: "thread.updated", at: thread.updatedAt, thread: { ...thread, status: "starting" } })
  try {
    // 旧任务没有保存过基线时不能在这里现抓一份，再把「接回时刻」冒充整段对话的开场
    const early = await launch(ctx, thread, {
      ...(thread.engineHandle === undefined ? {} : { resume: thread.engineHandle }),
      captureBaseline: false,
    })
    const entry = ctx.live.get(thread.id)
    if (entry === undefined) throw new Error("引擎起来之后会话没有接入")
    // 换了一家：引擎那边的会话清单也要叫同一个名字（和 `switchEngine` 同一条）
    if (entry.thread.engine !== record.engine) void entry.session.setTitle?.(entry.thread.title).catch(() => undefined)
    emit(ctx, { type: "thread.updated", at: ctx.deps.now(), thread: entry.thread })
    if (early !== undefined) rememberHandle(ctx, thread.id, early)
    return entry
  } catch (error) {
    giveBack(ctx, record, restore)
    throw error
  }
}

async function reviveFrom(
  ctx: Ctx,
  history: { thread: Thread; ran: ReadonlySet<string> },
  restore: Restore | undefined,
): Promise<Live> {
  const record = history.thread
  let thread: Thread
  try {
    thread = reattached(ctx, record, ctx.deps.now(), history.ran)
  } catch (error) {
    if (restore !== undefined) giveBack(ctx, record, restore)
    throw error
  }
  return attach(ctx, record, thread, restore)
}

/** 接回一条历史会话；已经活着就原样返回。`restore` 见 `Restore`。 */
export async function revive(ctx: Ctx, threadId: ThreadId, restore?: Restore): Promise<Live> {
  const live = ctx.live.get(threadId)
  if (live !== undefined) return live
  const history = await historyOf(ctx, threadId)
  if (history === undefined) throw new Error(`找不到会话 ${threadId} 的历史，无法接回引擎`)
  return reviveFrom(ctx, history, restore)
}

/** `thread.resume`：不发话、只接回。网页端的「接回来」和开发入口用它。 */
export async function resume(ctx: Ctx, cmd: Extract<Command, { type: "thread.resume" }>): Promise<void> {
  await revive(ctx, cmd.threadId)
}

/**
 * 「现在就切」落在一条历史会话上：**记着要换的那家才接回来**（兑现它），没记就什么都不做。
 * 和活会话上那颗按钮同一个意思——先把新那家起起来，好挑它自己报的模型。
 */
export async function switchHistory(ctx: Ctx, threadId: ThreadId): Promise<void> {
  const history = await historyOf(ctx, threadId)
  const to = history?.thread.nextEngine
  if (history === undefined || to === undefined || to === history.thread.engine || ctx.live.has(threadId)) return
  await reviveFrom(ctx, history, undefined)
}
