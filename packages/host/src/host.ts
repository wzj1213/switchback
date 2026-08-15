import type { Command, EngineId, Event, ThreadId, Thread, ThreadStatus, TurnId } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk, EngineDriver, EngineSession } from "@omni/engine"
import type { Rule } from "@omni/approval"
import type { Journal } from "@omni/journal"
import { createGate, type Gate } from "./gate.js"

export interface HostDeps {
  drivers: Readonly<Record<EngineId, EngineDriver>>
  /** 用户 home 绝对路径。approval 是纯函数不读环境，得由这里往下传。 */
  home: string
  emit: (event: Event) => void
  /** id 铸造。做成可注入的，测试里就能确定化。 */
  newId: (prefix: string) => string
  now: () => number
  /** 事件落盘。不传就不落——测试与无盘环境都能跑。 */
  journal?: Journal
}

export interface Host {
  dispatch: (command: Command) => Promise<void>
  dispose: () => Promise<void>
}

interface Live {
  thread: Thread
  session: EngineSession
  gate: Gate
  /** 当前未结束的轮次；审批卡要挂在它下面 */
  turn: TurnId | undefined
}

interface Ctx {
  deps: HostDeps
  live: Map<ThreadId, Live>
  /**
   * turn id → 它属于哪个会话。
   *
   * 落盘要按会话分文件，而 `turn.completed` / `item.*` 只带 turn id。
   * `Live.turn` 会在轮次结束时被清空，所以不能靠它——必须单独记一份。
   */
  turnOwner: Map<TurnId, ThreadId>
}

/** 一条事件属于哪个会话。判不出就不落盘——宁可少一条，也不要落到错的文件里。 */
function ownerOf(ctx: Ctx, event: Event): ThreadId | undefined {
  switch (event.type) {
    case "thread.started":
    case "thread.updated":
      return event.thread.id
    case "turn.started":
      return event.turn.threadId
    case "turn.completed":
      return ctx.turnOwner.get(event.turnId)
    case "item.started":
    case "item.updated":
      return ctx.turnOwner.get(event.item.turnId)
    case "usage.updated":
    case "engine.status":
      return event.threadId === "" ? undefined : event.threadId
    default:
      return undefined
  }
}

/**
 * **事件的唯一出口。** 所有 `emit` 都必须走这里，落盘才不会漏。
 *
 * 顺序有讲究：先发给渲染层，再落盘，最后才做旁路观察。
 * 界面响应不该等磁盘；而 `observe` 会改会话状态并再发事件，放最后免得穿插。
 */
function emit(ctx: Ctx, event: Event): void {
  if (event.type === "turn.started") ctx.turnOwner.set(event.turn.id, event.turn.threadId)
  ctx.deps.emit(event)
  const owner = ownerOf(ctx, event)
  if (owner !== undefined) void ctx.deps.journal?.append(owner, event)
  observe(ctx, event)
}

const DENIED: ApprovalAnswer = { allow: false, remember: "once" }

/**
 * 会话状态的唯一改写口。
 *
 * 状态一直挂在 `Thread` 上却从来没人改过，于是侧栏那个状态点永远是灰的、
 * 界面上也无从判断「它到底在不在跑」。**状态归宿主**——只有宿主同时看得见
 * 提示词发出、审批挂起、轮次收工这三件事。
 */
function setStatus(ctx: Ctx, entry: Live, status: ThreadStatus): void {
  if (entry.thread.status === status) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, status, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 引擎事件的旁路观察。轮次收工只有引擎知道，事件是直接发给渲染层的，
 * 宿主看不见——所以在这里截一道，把会话状态收回 idle。
 */
function observe(ctx: Ctx, event: Event): void {
  if (event.type !== "turn.completed") return
  for (const entry of ctx.live.values()) {
    if (entry.turn !== event.turnId) continue
    entry.turn = undefined
    setStatus(ctx, entry, event.status === "failed" ? "failed" : "idle")
    return
  }
}

async function askUser(ctx: Ctx, id: ThreadId, ask: ApprovalAsk): Promise<ApprovalAnswer> {
  const entry = ctx.live.get(id)
  // 会话已关闭却还有审批请求进来：按拒绝落定，不能让驱动永远等着
  if (entry === undefined || entry.turn === undefined) return DENIED
  setStatus(ctx, entry, "waiting_approval")
  try {
    return await entry.gate.open({
      ask,
      turnId: entry.turn,
      at: ctx.deps.now(),
      itemId: ctx.deps.newId("ap"),
    })
  } finally {
    // 无论批还是拒都回到运行中——轮次还没结束，引擎接着往下跑
    if (entry.thread.status === "waiting_approval") setStatus(ctx, entry, "running")
  }
}

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
  const memory: readonly Rule[] = []
  const early: { handle: string | undefined } = { handle: undefined }
  const session = await driver.start({
    threadId: thread.id,
    cwd: thread.cwd,
    trust: thread.trust,
    home: ctx.deps.home,
    memory,
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
  const gate = createGate((e) => {
    emit(ctx, e)
  })
  ctx.live.set(thread.id, { thread, session, gate, turn: undefined })
  return early.handle
}

async function create(ctx: Ctx, cmd: Extract<Command, { type: "thread.create" }>): Promise<void> {
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
async function resume(ctx: Ctx, cmd: Extract<Command, { type: "thread.resume" }>): Promise<void> {
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

async function prompt(ctx: Ctx, cmd: Extract<Command, { type: "thread.prompt" }>): Promise<void> {
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

async function setTrust(ctx: Ctx, cmd: Extract<Command, { type: "thread.setTrust" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) return
  await entry.session.setTrust(cmd.trust)
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, trust: cmd.trust, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** 审批卡 id 全局唯一，所以挨个会话问一遍即可；命中就停。 */
function resolveApproval(ctx: Ctx, cmd: Extract<Command, { type: "approval.resolve" }>): void {
  for (const entry of ctx.live.values()) {
    // 范围原样往下传：以前这里压成 boolean，engine 就再也分不出
    // 「这一次」和「这轮对话」了
    const hit = entry.gate.resolve(cmd.itemId, { allow: cmd.allow, remember: cmd.remember })
    if (hit) return
  }
}

async function dispatch(ctx: Ctx, command: Command): Promise<void> {
  switch (command.type) {
    case "thread.create":
      return create(ctx, command)
    case "thread.prompt":
      return prompt(ctx, command)
    case "thread.setTrust":
      return setTrust(ctx, command)
    case "thread.resume":
      return resume(ctx, command)
    case "thread.interrupt":
      return ctx.live.get(command.threadId)?.session.interrupt() ?? Promise.resolve()
    case "approval.resolve":
      resolveApproval(ctx, command)
      return Promise.resolve()
    case "thread.handoff":
      // L2 跨引擎接力尚未实现，见 README「已知限制」
      throw new Error("thread.handoff 尚未实现")
  }
}

async function dispose(ctx: Ctx): Promise<void> {
  // 先把挂着的审批按拒绝落定，否则驱动会卡在 canUseTool 里，dispose 挂死
  for (const entry of ctx.live.values()) entry.gate.settleAll()
  await Promise.all([...ctx.live.values()].map((e) => e.session.dispose()))
  ctx.live.clear()
}

export function createHost(deps: HostDeps): Host {
  const ctx: Ctx = { deps, live: new Map<ThreadId, Live>(), turnOwner: new Map<TurnId, ThreadId>() }
  return {
    dispatch: (command) => dispatch(ctx, command),
    dispose: () => dispose(ctx),
  }
}
