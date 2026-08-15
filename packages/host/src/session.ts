import type { Command, Event, ItemId, ThreadId, Thread } from "@omni/protocol"
import type { Rule } from "@omni/approval"
import { buildHandoff, renderHandoff } from "@omni/handoff"
import { initial, itemsOf, reduceAll } from "@omni/store"
import { createGate } from "./gate.js"
import { askUser } from "./approval.js"
import type { EngineSession } from "@omni/engine"
import { emit, setStatus, type Ctx, type Live } from "./ctx.js"
import type { Gate } from "./gate.js"

/**
 * 会话的生命周期：建、续跑、接力、发消息、改档、换模型、删。
 *
 * 从 `host.ts` 拆出来是因为那个文件撑过了 300 行闸门——但拆完读起来确实更顺：
 * `host.ts` 只剩「事件怎么出去、命令怎么分派」，这里是「一个会话怎么活」。
 */

function newThread(cmd: Extract<Command, { type: "thread.create" }>, id: ThreadId, at: number): Thread {
  return {
    id,
    title: cmd.title ?? "新会话",
    cwd: cmd.cwd,
    engine: cmd.engine,
    trust: cmd.trust,
    status: "idle",
    createdAt: at,
    updatedAt: at,
    engineHistory: [cmd.engine],
  }
}

/**
 * 记下引擎那边的会话句柄。
 *
 * 走 `thread.updated` 而不是私存一份：那样它才会跟着事件流落盘，
 * 下次启动读回来就在 `Thread` 上——**续跑需要的东西必须和历史存在同一个地方**，
 * 否则总有一天会出现「历史在但句柄丢了」。
 */
function rememberHandle(ctx: Ctx, id: ThreadId, handle: string): void {
  const entry = ctx.live.get(id)
  if (entry === undefined || entry.thread.engineHandle === handle) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, engineHandle: handle, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 起一个引擎会话并登记。`resume` 有值就是续跑。
 *
 * 返回**在登记完成之前就到达的句柄**。codex 在 `start()` 里就知道自己的 thread id，
 * 那时候 `ctx.live` 还没有这条会话，`rememberHandle` 会扑空——
 * 这个洞第一次跑真实会话才现形（落盘里根本没有 `engineHandle`）。
 * 交给调用方在发完自己的事件之后补上，顺序才是「started → updated」。
 */
async function launch(ctx: Ctx, thread: Thread, resume?: string): Promise<string | undefined> {
  const driver = ctx.deps.drivers[thread.engine]
  if (driver === undefined) throw new Error(`未注册的引擎：${thread.engine}`)
  const early: { handle: string | undefined } = { handle: undefined }
  // 先建条目再起引擎：驱动可能在 start() 里就回调，那时得能读到规则表
  const live: Live = {
    thread,
    session: undefined as unknown as EngineSession,
    gate: undefined as unknown as Gate,
    turn: undefined,
    rules: [...((await ctx.deps.rules?.read(thread.cwd)) ?? [])] as Rule[],
    suggests: new Map<ItemId, Rule>(),
  }
  const session = await driver.start({
    threadId: thread.id,
    cwd: thread.cwd,
    trust: thread.trust,
    home: ctx.deps.home,
    memory: () => live.rules,
    emit: (event) => {
      emit(ctx, event)
    },
    askUser: (ask) => askUser(ctx, thread.id, ask),
    onHandle: (handle) => {
      if (ctx.live.has(thread.id)) rememberHandle(ctx, thread.id, handle)
      else early.handle = handle
    },
    ...(resume === undefined ? {} : { resume }),
  })
  live.session = session
  live.gate = createGate((e) => {
    emit(ctx, e)
  })
  ctx.live.set(thread.id, live)
  // 模型清单要现问引擎——各家的可选项由它们自己的账号与配置决定，
  // omni 写死一份清单迟早会和实际能用的对不上。
  void session
    .models()
    .then((models) => {
      if (models.length > 0) {
        emit(ctx, { type: "models.updated", at: ctx.deps.now(), threadId: thread.id, models })
      }
    })
    .catch(() => undefined)
  return early.handle
}

export async function create(ctx: Ctx, cmd: Extract<Command, { type: "thread.create" }>): Promise<void> {
  const at = ctx.deps.now()
  const thread = newThread(cmd, ctx.deps.newId("th"), at)
  const early = await launch(ctx, thread)
  emit(ctx, { type: "thread.started", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
}

/**
 * 让一个从磁盘回放出来的会话重新接上引擎。
 *
 * 会话记录只在渲染层（回放不经过宿主），所以这里要**自己从日志里把它读回来**。
 * 没有句柄就不给续——那种情况下起的是个全新会话，模型对上面那段对话一无所知，
 * 而界面看起来像是接上了。**宁可报错也不要制造这种错觉。**
 */
export async function resume(ctx: Ctx, cmd: Extract<Command, { type: "thread.resume" }>): Promise<void> {
  if (ctx.live.has(cmd.threadId)) return
  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const record = [...events]
    .reverse()
    .find((e): e is Extract<Event, { type: "thread.started" | "thread.updated" }> =>
      e.type === "thread.started" || e.type === "thread.updated",
    )
  if (record === undefined) throw new Error(`找不到会话 ${cmd.threadId} 的历史，无法续跑`)
  const handle = record.thread.engineHandle
  if (handle === undefined) {
    throw new Error("这个会话没有留下引擎侧的句柄（可能是旧版本记录），只能新建会话继续")
  }
  const at = ctx.deps.now()
  const thread: Thread = { ...record.thread, detached: false, status: "idle", updatedAt: at }
  const early = await launch(ctx, thread, handle)
  emit(ctx, { type: "thread.updated", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
}

export async function prompt(ctx: Ctx, cmd: Extract<Command, { type: "thread.prompt" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  const at = ctx.deps.now()
  const turnId = ctx.deps.newId("tn")
  entry.turn = turnId
  const turn = {
    id: turnId,
    threadId: cmd.threadId,
    engine: entry.thread.engine,
    status: "running" as const,
    startedAt: at,
  }
  setStatus(ctx, entry, "running")
  emit(ctx, { type: "turn.started", at, turn })
  emit(ctx, {
    type: "item.started",
    at,
    item: { id: ctx.deps.newId("it"), turnId, kind: "user_message", at, text: cmd.text },
  })
  await entry.session.prompt(cmd.text, turnId)
}

export async function setTrust(ctx: Ctx, cmd: Extract<Command, { type: "thread.setTrust" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) return
  await entry.session.setTrust(cmd.trust)
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, trust: cmd.trust, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

export async function setModel(ctx: Ctx, cmd: Extract<Command, { type: "thread.setModel" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) return
  await entry.session.setModel(cmd.model, cmd.effort)
  const at = ctx.deps.now()
  entry.thread = {
    ...entry.thread,
    model: cmd.model,
    ...(cmd.effort === undefined ? {} : { effort: cmd.effort }),
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * L3 分叉：同一个目标，换一家再跑一遍。
 *
 * 和接力（L2）**只差一件事**：原会话不停。所以代码上也只差一件事——
 * 不 dispose 旧的、不复用旧的 thread id。
 *
 * 交的还是那份交接包，但语义不同：接力是「接着做」，分叉是「你也做一遍」。
 * 所以只取**目标**，不带「已改动的文件」——那会让第二家以为活已经干了一半。
 */
export async function fork(ctx: Ctx, cmd: Extract<Command, { type: "thread.fork" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  if (ctx.deps.drivers[cmd.to] === undefined) throw new Error(`未注册的引擎：${cmd.to}`)

  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const packet = buildHandoff(entry.thread, itemsOf(reduceAll(initial(), events), cmd.threadId))

  const at = ctx.deps.now()
  const thread: Thread = {
    ...entry.thread,
    id: ctx.deps.newId("th"),
    engine: cmd.to,
    engineHistory: [cmd.to],
    engineHandle: undefined,
    model: undefined,
    effort: undefined,
    // 标题带上引擎名，否则侧栏里两个会话长得一模一样
    title: `${entry.thread.title}（${cmd.to}）`,
    detached: false,
    status: "idle",
    createdAt: at,
    updatedAt: at,
  }
  const early = await launch(ctx, thread)
  emit(ctx, { type: "thread.started", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)

  const asks = packet.asks.length === 0 ? "" : `\n\n过程中追加过的要求：\n${packet.asks.map((a) => `- ${a}`).join("\n")}`
  await prompt(ctx, {
    type: "thread.prompt",
    threadId: thread.id,
    text: `${packet.goal}${asks}`,
  })
}

/**
 * 关掉会话并把记录从磁盘上删掉。
 *
 * 顺序是有讲究的：**先落定挂着的审批，再 dispose，最后才删文件**。
 * 反过来的话，一个还在等审批的驱动会卡在那里，而它的日志文件已经没了——
 * 之后它写的每一条都会把文件重新建出来，删除等于没删。
 *
 * 对回放出来的会话（宿主这边没有登记）同样有效：直接删文件即可。
 */
export async function remove(ctx: Ctx, cmd: Extract<Command, { type: "thread.delete" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry !== undefined) {
    entry.gate.settleAll()
    await entry.session.dispose()
    ctx.live.delete(cmd.threadId)
  }
  await ctx.deps.journal?.remove(cmd.threadId)
  emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: cmd.threadId })
}

/**
 * L2 跨引擎接力：同一个会话换一家引擎接着做。
 *
 * **不传原始上下文**——各家 session 格式不通，硬翻既做不对也维护不起。
 * 传的是从 transcript 里提炼出来的**交接包**（见 `@omni/handoff`）。
 *
 * transcript 在渲染层的 store 里，宿主手上没有。但宿主有日志——
 * 把事件回放一遍过同一个归约器就得到同一份 items。
 * **这正是「事件流是真源、归约器是纯函数」这条设计换来的**：
 * 不需要为宿主再维护一份 transcript 副本，也就不会出现两份对不上。
 */
export async function handoff(ctx: Ctx, cmd: Extract<Command, { type: "thread.handoff" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  if (entry.thread.engine === cmd.to) return
  if (ctx.deps.drivers[cmd.to] === undefined) throw new Error(`未注册的引擎：${cmd.to}`)

  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const from = entry.thread.engine
  const packet = buildHandoff(entry.thread, itemsOf(reduceAll(initial(), events), cmd.threadId))

  // 先停旧的再起新的：两个引擎同时对着一个工作区写，是最难查的一类冲突
  entry.gate.settleAll()
  await entry.session.dispose()
  ctx.live.delete(cmd.threadId)

  const at = ctx.deps.now()
  const thread: Thread = {
    ...entry.thread,
    engine: cmd.to,
    engineHistory: [...entry.thread.engineHistory, cmd.to],
    // 换了引擎，上一家的会话句柄就没用了——留着会在续跑时拿它去问新的一家
    engineHandle: undefined,
    model: undefined,
    effort: undefined,
    status: "idle",
    updatedAt: at,
  }
  const early = await launch(ctx, thread)
  emit(ctx, { type: "thread.updated", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)

  // 交接包作为第一条消息发出去，**并且进 transcript**——
  // 用户要看得见接手的一家究竟被告知了什么
  await prompt(ctx, { type: "thread.prompt", threadId: cmd.threadId, text: renderHandoff(packet, from, cmd.to) })
}
