import type { Command, ThreadId, TurnId } from "@omni/protocol"
import { resolveApproval } from "./approval.js"
import { type Ctx, type Live } from "./ctx.js"
import type { HostDeps } from "./deps.js"
import {
  create,
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
    case "thread.delete":
      return remove(ctx, command)
    case "thread.setModel":
      return setModel(ctx, command)
    case "thread.handoff":
      return handoff(ctx, command)
    case "thread.interrupt":
      return ctx.live.get(command.threadId)?.session.interrupt() ?? Promise.resolve()
    case "approval.resolve":
      resolveApproval(ctx, command)
      return Promise.resolve()
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
