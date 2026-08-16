import type { Command } from "@omni/protocol"
import { emit, setStatus, type Ctx, type Live } from "./ctx.js"

/**
 * 一句话怎么送到引擎。
 *
 * 从 `session.ts` 拆出来是行数闸门逼的，但这条边界本来就该有：
 * 那边回答的是**「一个会话怎么活」**（建、续、接力、分叉、删），
 * 这里回答的是**「说的这句话走哪条路」**——开新轮次、插进正在跑的那一轮、
 * 还是排队等着。三条路的取舍逻辑集中在一个文件里，才看得出它们是互斥的三选一。
 */

/** 排进队里等这一轮跑完。**队列不碰 `entry.turn`**——那条硬约束见下。 */
function enqueue(ctx: Ctx, entry: Live, text: string): void {
  const at = ctx.deps.now()
  entry.queued = [...entry.queued, text]
  entry.thread = { ...entry.thread, queued: [...entry.queued], updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 试着把这句话递进**正在跑的那一轮**。成了返回 true，没成返回 false（调用方排队）。
 *
 * ## 为什么先 steer 再发 item
 *
 * 反过来的话，steer 失败时 transcript 里已经多了一条**根本没送出去的**用户消息。
 * 那比等待更糟：你以为说过了。现在的顺序保证「界面上出现」等价于「引擎收到了」。
 *
 * ## 为什么失败就退回排队，而不是报错
 *
 * 失败的主因是那一轮刚好收工（codex 的 `expectedTurnId` 对不上就拒绝）。
 * 那种情况下这句话本来就该走队列——而队列会被 `drain` 立刻发出去，
 * 用户看到的就是「正常发出去了」。**一个能自愈的竞态不该做成错误提示。**
 */
async function steerInto(
  ctx: Ctx,
  entry: Live,
  cmd: Extract<Command, { type: "thread.prompt" }>,
): Promise<boolean> {
  const turnId = entry.turn
  const steer = entry.session.steer
  if (turnId === undefined || steer === undefined || entry.thread.capabilities?.steer !== true) {
    return false
  }
  try {
    await steer.call(entry.session, cmd.text, cmd.attachments)
  } catch {
    return false
  }
  const at = ctx.deps.now()
  // **挂在当前这一轮上**，不是新的一轮：它是对这一轮的追加，
  // transcript 里就该出现在它实际插话的那个位置
  emit(ctx, {
    type: "item.started",
    at,
    item: {
      id: ctx.deps.newId("it"),
      turnId,
      kind: "user_message",
      at,
      text: cmd.text,
      ...(cmd.attachments === undefined || cmd.attachments.length === 0
        ? {}
        : { attachments: cmd.attachments }),
    },
  })
  return true
}

/**
 * @param origin 这条不是人打的时候标一下（目前只有接力包）。引擎侧照旧当成
 *   用户消息发过去——**要改的只是界面怎么呈现**，不是引擎怎么理解。
 */
export async function prompt(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.prompt" }>,
  origin?: "handoff",
): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  /**
   * **上一轮没跑完时不开新轮次。** 这条硬约束一直没变：`entry.turn` 绝不能被
   * 新 turnId 覆盖——引擎还在往**旧的** turnId 上发 item，覆盖之后那些 item
   * 从此无主，正在流的回答会整个消失。
   *
   * 变的是「那这句话怎么办」，前后共三版：
   *
   * 1. **抛错**，界面靠禁用输入框配合。而人在 agent 跑的时候最想做的事恰恰是
   *    补一句（「不对，用另一个文件」），逼他先中断等于丢掉已经做完的一半。
   * 2. **排队**：记下来，这一轮停了再发。不丢东西，但那句话要等几十秒才起作用
   *    ——而它往往正是「别再往下走了」，等它跑完再说等于白说。
   * 3. **能改向的就当场改向**（现在）：codex 的 `turn/steer` 把话直接递进正在跑的
   *    那一轮。递不进去（引擎不支持、或那一轮刚好收工）才退回排队。
   *
   * 三版都守住了那条硬约束：steer 和队列**都不碰 `entry.turn`**。
   */
  if (entry.turn !== undefined) {
    if (await steerInto(ctx, entry, cmd)) return
    enqueue(ctx, entry, cmd.text)
    return
  }
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
    item: {
      id: ctx.deps.newId("it"),
      turnId,
      kind: "user_message",
      at,
      text: cmd.text,
      ...(cmd.attachments === undefined || cmd.attachments.length === 0
        ? {}
        : { attachments: cmd.attachments }),
      ...(origin === undefined ? {} : { origin }),
    },
  })
  await entry.session.prompt(cmd.text, turnId, cmd.attachments)
}
