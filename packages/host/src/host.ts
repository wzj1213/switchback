import type { Command, Event, Thread, ThreadId, TurnId } from "@omni/protocol"
import { resolveApproval } from "./approval.js"
import { clearQueue, discardUnstarted, emit, liveStateOf, withQueue, type Ctx, type Live, type QueuedPrompt } from "./ctx.js"
import type { HostDeps } from "./deps.js"
import { create, remove, rename, resume, setModel } from "./session.js"
import { adopt } from "./adoption.js"
import { setTrust } from "./trust.js"
import { fork, handoff, rewind, switchEngine } from "./branch.js"
import { sideQuestion } from "./engine-state.js"
import { prompt, steerQueued } from "./prompt.js"
import { recordSegment } from "./segment.js"

export type { HostDeps } from "./deps.js"

/**
 * 会话编制。**唯一允许做编排的地方。**
 *
 * 这个文件本身只剩两件事：命令怎么分派、进程怎么收场。
 * 「一个会话怎么活」在 `session.ts`，「审批怎么问怎么记」在 `approval.ts`，
 * 「事件怎么出去」在 `ctx.ts`。
 */
export interface Host {
  dispatch: (command: Command) => Promise<void>
  /**
   * 现在还活着的会话——**背后有引擎进程的那些**。
   *
   * 窗口重载时要用它把「活的」和「磁盘上的历史」分开：两者在 journal 里
   * 长得一模一样，但活的那个输入框该是能用的，历史那个不该。
   * 分不开的后果是重载之后整个应用变成只读，而引擎其实还在跑。
   */
  live: () => readonly Thread[]
  /**
   * 不落盘、但描述现状的事件（斜杠命令、额度），各留最后一条。
   *
   * 重建全量时**必须**把它们补进去：它们既不在 journal 里，
   * 又会被渲染层按 `seq <= resumeAt` 当旧消息丢掉——两头都不留，就永久没了。
   * 实测代价是 `/` 面板里一条技能都不显示，而链路上每一环看起来都是好的。
   */
  liveState: () => readonly Event[]
  dispose: () => Promise<void>
}

/**
 * 命令 → 处理函数。
 *
 * 和归约器同一个做法：**由联合类型映射出来的表**，漏接一种命令编译不过。
 * switch 的 `default` 会把漏接藏成「点了没反应」，那是最难查的一类故障。
 */
type Handlers = {
  [K in Command["type"]]: (ctx: Ctx, command: Extract<Command, { type: K }>) => Promise<void>
}

function takeBack(
  ctx: Ctx,
  command: Extract<Command, { type: "thread.unqueue" }>,
): Promise<void> {
  const entry = ctx.live.get(command.threadId)
  if (entry === undefined || entry.queued.length === 0) return Promise.resolve()
  const first = entry.queued[0]
  const offset = first !== undefined && entry.draining === first ? 1 : 0
  const taken = entry.queued.slice(offset)
  if (taken.length === 0) return Promise.resolve()
  entry.queued = entry.queued.slice(0, offset)
  const attachments = [...new Set(taken.flatMap((prompt) => prompt.attachments ?? []))]
  const at = ctx.deps.now()
  const next = {
    ...withQueue(entry.thread, entry.queued, at),
    draft: taken.map((prompt) => prompt.text).join("\n"),
    draftRevision: ctx.deps.newId("dr"),
  }
  delete next.draftAttachments
  if (attachments.length > 0) next.draftAttachments = attachments
  entry.thread = next
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
  return Promise.resolve()
}

const HANDLERS: Handlers = {
  "thread.create": create,
  "thread.sideQuestion": sideQuestion,
  "thread.adopt": adopt,
  "thread.prompt": prompt,
  "thread.setTrust": setTrust,
  "thread.rename": rename,
  "thread.setModel": setModel,
  "thread.resume": resume,
  "thread.delete": remove,
  "thread.handoff": handoff,
  "thread.fork": fork,
  "thread.rewind": rewind,
  "thread.compact": async (ctx, command) => {
    const entry = ctx.live.get(command.threadId)
    if (entry === undefined || !entry.lease.active || entry.session.compact === undefined) return
    await entry.session.compact()
  },
  /**
   * 现在就切引擎（模型选择器上那颗按钮）。**没有待切换的就什么都不做**——
   * 这条命令表达的是「把已经记下的那个意向立刻兑现」，不是「切到某一家」，
   * 所以它不带目标：目标早就在 `thread.nextEngine` 上了，另传一个只会多一处能对不上的地方。
   */
  "thread.switchNow": async (ctx, command) => {
    const entry = ctx.live.get(command.threadId)
    const to = entry?.thread.nextEngine
    if (entry === undefined || to === undefined || to === entry.thread.engine) return
    await switchEngine(ctx, command.threadId, to)
  },
  "thread.steerQueued": steerQueued,
  "thread.unqueue": takeBack,
  "thread.interrupt": async (ctx, command) => {
    const entry = ctx.live.get(command.threadId)
    // **按停止就是要它停下**，排着队的那几句一并作废——
    // 「停完这句再跑下一句」不是任何人按停止时想要的
    if (entry !== undefined && entry.queued.length > 0) clearQueue(ctx, entry)
    await entry?.session.interrupt()
  },
  "approval.resolve": (ctx, command) => {
    resolveApproval(ctx, command)
    return Promise.resolve()
  },
}

/**
 * 哪些命令要按「在途去重」拦一道，键是什么。
 *
 * **只拦「起引擎」那几条。** 它们都要 spawn 子进程，重入的代价是真的多起一个
 * 进程、多出一个会话——实测点三下新建会出三个 codex。
 * 其余命令不拦：`prompt` 连发两条是合法的（用户就是想追加一句），
 * `interrupt` 更是越快越好。
 *
 * `thread.create` 的键带上 (cwd, engine, trust)：**同一个目录开第二个会话是
 * 合法用法**，不能永久拦住；拦的只是「同一个请求还没落定就又来一次」。
 */
function inflightKey(command: Command): string | undefined {
  switch (command.type) {
    case "thread.create":
      // kind 也要进键：将来生成策略若变成固定目录，没有 kind 就会把
      // 「连开两条对话」当成重复去掉一条
      return `create:${command.cwd}:${command.engine}:${command.trust}:${command.workspaceKind ?? "project"}`
    case "thread.adopt":
      // 同一个原生句柄同时接两次会争同一把 writer 锁；omni thread id 此时尚未铸好，
      // 所以键必须落在 (engine, handle) 上，而不是之后才有的本地 id。
      return `adopt:${command.engine}:${command.handle}`
    case "thread.resume":
      return `resume:${command.threadId}`
    case "thread.switchNow":
      return `switch:${command.threadId}`
    case "thread.fork":
      return `fork:${command.threadId}:${command.to}`
    case "thread.rewind":
      return `rewind:${command.threadId}:${command.turnId}`
    default:
      return undefined
  }
}

/** 这些动作改变同一条原生会话，必须按点击顺序执行；最后一次选择才应最终生效。 */
function serialKey(command: Command): string | undefined {
  if (command.type === "thread.sideQuestion") return `aside:${command.threadId}`
  switch (command.type) {
    // prompt 也要进同一条队：它可能在真正发送前兑现 nextEngine。否则“发送”与
    // “立即切换”同拍会各起一个新 session，其中一条最终变成无人持有的进程。
    case "thread.prompt":
    case "thread.fork":
    case "thread.resume":
    case "thread.rewind":
    case "thread.handoff":
    case "thread.rename":
    case "thread.setModel":
    case "thread.setTrust":
    case "thread.switchNow":
      return `configure:${command.threadId}`
    default:
      return undefined
  }
}

/**
 * 分派。
 *
 * 起引擎那几条命令**在途期间重入直接复用同一个 Promise**，不再起第二次。
 * 拦在这一层而不是界面上：界面有好几个入口（按钮、菜单、快捷键、右键菜单），
 * 每个入口各加一次防抖迟早会漏掉一个，而漏掉的代价是一个孤儿子进程。
 */
async function runCommand(ctx: Ctx, command: Command): Promise<void> {
  if (ctx.closed) throw new Error("宿主已经关闭")
  const handler = HANDLERS[command.type] as (ctx: Ctx, command: Command) => Promise<void>
  await handler(ctx, command)
}

async function serialDispatch(ctx: Ctx, command: Command): Promise<void> {
  if (command.type === "thread.prompt") {
    const entry = ctx.live.get(command.threadId)
    // 切换/重启已经进入过渡壳，或首句 prompt RPC 还没回包但 Turn 已经建立时，
    // 后续输入都应立刻入队。继续等 configure Promise 会让输入框先清空、队列却几秒不出现。
    if (entry?.lease.active === false || entry?.turn !== undefined) return runCommand(ctx, command)
  }
  const key = serialKey(command)
  if (key === undefined) return runCommand(ctx, command)
  const previous = ctx.serial.get(key) ?? Promise.resolve()
  const started = previous.catch(() => undefined).then(() => runCommand(ctx, command))
  ctx.serial.set(key, started)
  try {
    await started
  } finally {
    if (ctx.serial.get(key) === started) ctx.serial.delete(key)
  }
}

async function dispatch(ctx: Ctx, command: Command): Promise<void> {
  if (ctx.closed) throw new Error("宿主已经关闭")
  const key = inflightKey(command)
  if (key === undefined) return serialDispatch(ctx, command)
  const running = ctx.inflight.get(key)
  if (running !== undefined) return running
  // 从排进串行队列的这一刻就占位；否则同拍的第二次 fork 会排在后面，等第一条
  // 清掉运行期标记后再起一个进程，表面串行、实质没有去重。
  const started = serialDispatch(ctx, command).finally(() => {
    if (ctx.inflight.get(key) === started) ctx.inflight.delete(key)
  })
  ctx.inflight.set(key, started)
  return started
}

async function dispose(ctx: Ctx): Promise<void> {
  if (ctx.closed) return
  const temporary = [...ctx.uncommitted.keys()]
  // 先趁事件出口还开着把审批按拒绝落盘；随后立刻封出口，promise 续体也来不及串回。
  for (const entry of ctx.live.values()) entry.gate.settleAll()
  ctx.closed = true
  for (const entry of ctx.live.values()) {
    entry.lease.active = false
  }
  // 退出不能被某一家驱动的清理错误卡住；未说过话的会话不进历史，基线也不能留成孤儿。
  await Promise.all([
    ...[...ctx.live.values()].map((entry) => entry.session.dispose().catch(() => undefined)),
    ...temporary.map((threadId) => discardUnstarted(ctx, threadId)),
  ])
  ctx.live.clear()
}

function beginDrain(ctx: Ctx, threadId: ThreadId, next: QueuedPrompt): boolean {
  const starting = ctx.live.get(threadId)
  if (starting === undefined || starting.queued[0] !== next || starting.draining !== undefined) return false
  starting.draining = next
  return true
}

function failDrain(ctx: Ctx, threadId: ThreadId, next: QueuedPrompt, error: unknown): void {
  if (ctx.closed || ctx.removed.has(threadId)) return
  const current = ctx.live.get(threadId)
  if (current?.draining === next) current.draining = undefined
  ctx.deps.emit({
    type: "engine.status",
    at: ctx.deps.now(),
    threadId,
    status: "crashed",
    detail: `排队的那句没发出去：${String(error)}`,
  })
}

function finishDrain(ctx: Ctx, threadId: ThreadId, next: QueuedPrompt): void {
  const entry = ctx.live.get(threadId)
  if (entry?.draining !== next) return
  entry.draining = undefined
  // 成功送达之后才摘；失败、切换回滚或用户已经手动取消时都不误删。
  if (entry.queued[0] !== next) return
  entry.queued = entry.queued.slice(1)
  const at = ctx.deps.now()
  entry.thread = withQueue(entry.thread, entry.queued, at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

async function drainOne(ctx: Ctx, threadId: ThreadId, next: QueuedPrompt): Promise<void> {
  if (!beginDrain(ctx, threadId, next)) return
  try {
    // 走统一分派，让排队消息与模型/档位/切换服从同一操作顺序。
    await dispatch(ctx, { type: "thread.prompt", threadId, text: next.text, ...(next.attachments === undefined ? {} : { attachments: next.attachments }) })
  } catch (error) {
    failDrain(ctx, threadId, next, error)
    return
  }
  finishDrain(ctx, threadId, next)
}

export function createHost(deps: HostDeps): Host {
  const ctx: Ctx = {
    deps,
    closed: false,
    live: new Map<ThreadId, Live>(),
    removed: new Set<ThreadId>(),
    turnOwner: new Map<TurnId, ThreadId>(),
    inflight: new Map<string, Promise<void>>(),
    serial: new Map<string, Promise<void>>(),
    liveState: new Map<string, Event>(),
    uncommitted: new Map<ThreadId, Event[]>(),
  }
  /**
   * 一轮跑完就把排队的下一句发出去。
   *
   * **一次只发一句**：发完那句又开了一轮，跑完再由这里接着发下一句。
   * 一口气全推给引擎是错的——那等于把「我看着它跑、随时补一句」
   * 变成「我一次性交代五件事」，而后者本来就该写在同一句话里。
   */
  ctx.afterTurn = (threadId) => {
    const entry = ctx.live.get(threadId)
    if (entry !== undefined) void recordSegment(ctx, entry)
  }
  ctx.drain = (threadId) => {
    const entry = ctx.live.get(threadId)
    const next = entry?.queued[0]
    if (entry === undefined || next === undefined || entry.draining !== undefined) return
    void drainOne(ctx, threadId, next)
  }
  return {
    dispatch: (command) => dispatch(ctx, command),
    live: () => [...ctx.live.values()].map((entry) => entry.thread),
    liveState: () => liveStateOf(ctx),
    dispose: () => dispose(ctx),
  }
}
