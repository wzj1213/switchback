import type { Command, ThreadId, TurnId } from "@omni/protocol"
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

async function dispatch(ctx: Ctx, command: Command): Promise<void> {
  const handler = HANDLERS[command.type] as (ctx: Ctx, command: Command) => Promise<void>
  await handler(ctx, command)
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
