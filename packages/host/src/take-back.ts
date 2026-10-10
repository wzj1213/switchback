import type { Command } from "@switchback/protocol"
import { handBack, type Ctx } from "./ctx.js"
import { handedBack, promptsOf, type QueuedPrompt } from "./queued.js"
import { updateRecord } from "./revive.js"

/**
 * 把排着队的话取回输入框。
 *
 * ## 一条还是整队
 *
 * `cmd.index` 给了就只取那一条，缺席就整队一起取（老行为）。
 * **两种粒度都得留着**：改主意时想拿回的常常只是最后那句，
 * 而「算了都不发了」也是个真实的动作。
 *
 * ## 队首可能已经在路上了
 *
 * `entry.draining` 是已经进了发送流程、还没等到 prompt 确认的那一条。
 * 它不能被取回——取回它等于把一句**已经交出去的话**再复制一份到输入框，
 * 而它照样会跑。所以它永远留在队首，`offset` 把它让开。
 */
export function takeBack(
  ctx: Ctx,
  command: Extract<Command, { type: "thread.unqueue" }>,
): Promise<void> {
  const entry = ctx.live.get(command.threadId)
  // 换引擎握手里新条目已经登记、还在 activate（Kimi 要先连实时流）：这时取回落在它身上，
  // 装好那一刻又会被旧壳的队列整份盖掉——撤回的话照样发出去。等这次切换做完再取
  const switching = entry?.lease.installing === true ? ctx.serial.get(`configure:${command.threadId}`) : undefined
  if (switching !== undefined) {
    // 下标是点下去那一刻的位置；等完之后队首可能已经发出去了，按内容找回点的那一句
    const picked = command.index === undefined ? undefined : entry?.queued[command.index]
    return switching.catch(() => undefined).then(() => takeBack(ctx, relocated(ctx, command, picked)))
  }
  if (entry === undefined) return takeBackRecord(ctx, command)
  if (entry.queued.length === 0) return Promise.resolve()
  const first = entry.queued[0]
  const offset = first !== undefined && entry.draining === first ? 1 : 0
  const picked = pick(entry.queued, offset, command.index)
  if (picked !== undefined) handBack(ctx, entry, picked.taken)
  return Promise.resolve()
}

/** 历史会话（背后没有进程）：记录里排着的照样取回——摘出队列、放进草稿、落盘。 */
function takeBackRecord(ctx: Ctx, command: Extract<Command, { type: "thread.unqueue" }>): Promise<void> {
  return updateRecord(ctx, command.threadId, (thread) => {
    const picked = pick(promptsOf(thread), 0, command.index)
    return picked === undefined ? thread : handedBack(thread, picked, ctx.deps.newId("dr"), ctx.deps.now())
  })
}

/** 点的那一句现在排在第几；已经不在队里（发出去了）就给一个必然落空的下标。 */
function relocated(
  ctx: Ctx,
  command: Extract<Command, { type: "thread.unqueue" }>,
  picked: QueuedPrompt | undefined,
): Extract<Command, { type: "thread.unqueue" }> {
  if (picked === undefined) return command
  const same = (prompt: QueuedPrompt): boolean => prompt.text === picked.text &&
    (prompt.attachments ?? []).join("\n") === (picked.attachments ?? []).join("\n")
  return { ...command, index: ctx.live.get(command.threadId)?.queued.findIndex(same) ?? -1 }
}

/**
 * 挑出要取回的那几条，并给出剩下的队列。挑不出来就是 `undefined`（什么都不做）。
 *
 * **下标在这里验，不在协议那层验**：这条命令也能从远程来（`remote/policy.ts`
 * 只校验必需字段的类型），而一个 `1.5` 或者 `-1` 走到 `splice` 会静默地
 * 剪掉不该剪的那条。宿主是队列的权威，越界的一律当没说过。
 */
function pick(
  queued: readonly QueuedPrompt[],
  offset: number,
  index: number | undefined,
): { taken: QueuedPrompt[]; rest: QueuedPrompt[] } | undefined {
  if (index === undefined) {
    const taken = queued.slice(offset)
    return taken.length === 0 ? undefined : { taken, rest: queued.slice(0, offset) }
  }
  if (!Number.isInteger(index) || index < offset || index >= queued.length) return undefined
  const one = queued[index]
  if (one === undefined) return undefined
  return { taken: [one], rest: [...queued.slice(0, index), ...queued.slice(index + 1)] }
}
