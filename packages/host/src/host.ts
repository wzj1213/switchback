import type { Command, Thread, ThreadId, TurnId } from "@omni/protocol"
import { resolveApproval } from "./approval.js"
import { type Ctx, type Live } from "./ctx.js"
import type { HostDeps } from "./deps.js"
import {
  create,
  fork,
  handoff,
  prompt,
  remove,
  resume,
  setModel,
  setTrust,
} from "./session.js"

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
  "thread.prompt": prompt,
  "thread.setTrust": setTrust,
  "thread.setModel": setModel,
  "thread.resume": resume,
  "thread.delete": remove,
  "thread.handoff": handoff,
  "thread.fork": fork,
  "thread.interrupt": async (ctx, command) => {
    await ctx.live.get(command.threadId)?.session.interrupt()
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
      return `create:${command.cwd}:${command.engine}:${command.trust}`
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
  }
  return {
    dispatch: (command) => dispatch(ctx, command),
    live: () => [...ctx.live.values()].map((entry) => entry.thread),
    dispose: () => dispose(ctx),
  }
}
