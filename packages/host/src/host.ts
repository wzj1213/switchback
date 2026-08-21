import type { Command, Event, Thread, ThreadId, TurnId } from "@omni/protocol"
import { resolveApproval } from "./approval.js"
import { clearQueue, emit, liveStateOf, type Ctx, type Live } from "./ctx.js"
import type { HostDeps } from "./deps.js"
import { adopt, create, remove, rename, resume, setModel } from "./session.js"
import { setTrust } from "./trust.js"
import { fork, handoff, rewind, switchEngine } from "./branch.js"
import { sideQuestion } from "./engine-state.js"
import { prompt, recordSegment, steerQueued } from "./prompt.js"

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
    if (entry?.session.compact === undefined) return
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
  "thread.unqueue": (ctx, command) => {
    const entry = ctx.live.get(command.threadId)
    if (entry !== undefined && entry.queued.length > 0) clearQueue(ctx, entry)
    return Promise.resolve()
  },
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
    case "thread.handoff":
      return `handoff:${command.threadId}`
    case "thread.fork":
      return `fork:${command.threadId}`
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
async function dispatch(ctx: Ctx, command: Command): Promise<void> {
  const handler = HANDLERS[command.type] as (ctx: Ctx, command: Command) => Promise<void>
  const key = inflightKey(command)
  if (key === undefined) {
    await handler(ctx, command)
    return
  }
  const running = ctx.inflight.get(key)
  if (running !== undefined) {
    await running
    return
  }
  // finally 里删掉：失败也要放行，否则一次失败就把这个键永久锁死
  const started = handler(ctx, command).finally(() => {
    ctx.inflight.delete(key)
  })
  ctx.inflight.set(key, started)
  await started
}

async function dispose(ctx: Ctx): Promise<void> {
  // 先把挂着的审批按拒绝落定，否则驱动会卡在 canUseTool 里，dispose 挂死
  for (const entry of ctx.live.values()) entry.gate.settleAll()
  await Promise.all([...ctx.live.values()].map((e) => e.session.dispose()))
  ctx.live.clear()
}

export function createHost(deps: HostDeps): Host {
  const ctx: Ctx = {
    deps,
    live: new Map<ThreadId, Live>(),
    turnOwner: new Map<TurnId, ThreadId>(),
    inflight: new Map<string, Promise<void>>(),
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
    const next = entry?.queued.shift()
    if (entry === undefined || next === undefined) return
    const at = ctx.deps.now()
    entry.thread = { ...entry.thread, queued: [...entry.queued], updatedAt: at }
    emit(ctx, { type: "thread.updated", at, thread: entry.thread })
    void prompt(ctx, { type: "thread.prompt", threadId, text: next }).catch((error: unknown) => {
      ctx.deps.emit({
        type: "engine.status",
        at: ctx.deps.now(),
        threadId,
        status: "crashed",
        detail: `排队的那句没发出去：${String(error)}`,
      })
    })
  }
  return {
    dispatch: (command) => dispatch(ctx, command),
    live: () => [...ctx.live.values()].map((entry) => entry.thread),
    liveState: () => liveStateOf(ctx),
    dispose: () => dispose(ctx),
  }
}
