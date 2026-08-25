import type { NotifyContext } from "./notify.js"
import type { WireTokenUsage } from "./wire.js"

/** 上下文占用取 last；total 是累计账单，只用于总消耗。 */
export function onUsage(ctx: NotifyContext, params: WireTokenUsage): void {
  const usage = params.tokenUsage
  const used = usage?.last?.totalTokens
  if (usage === undefined || used === undefined) return
  ctx.emit({
    type: "usage.updated",
    at: ctx.now(),
    threadId: ctx.threadId,
    engine: "codex",
    usage: {
      contextUsed: used,
      ...(usage.modelContextWindow === undefined
        ? {}
        : { contextWindow: usage.modelContextWindow }),
      ...(usage.total?.totalTokens === undefined ? {} : { totalTokens: usage.total.totalTokens }),
    },
  })
}
