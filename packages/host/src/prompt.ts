import type { Command } from "@omni/protocol"
import { switchEngine } from "./branch.js"
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
 * 这条会话**转正**。发出第一句话的那一刻做，一次。
 *
 * 两件事一起清，因为它们说的是同一件事——「它开始算数了」：
 *
 * - `provisional`：临时会话不进侧栏、切引擎当场生效（见 `Thread.provisional`）。
 *   这条 `thread.updated` 排在 `turn.started` **之前**，所以攒着的那些事件
 *   跟着一起落盘，而且顺序是对的（见 `Ctx.uncommitted`）。
 * - `draft`：**发出去了就不再是草稿**。不清的话，用户改了内容发出去之后，
 *   下次开这条会话输入框里又冒出那段原始文本。
 */
function commit(ctx: Ctx, entry: Live, at: number): void {
  if (entry.thread.provisional !== true && entry.thread.draft === undefined) return
  const next = { ...entry.thread }
  delete next.provisional
  delete next.draft
  entry.thread = { ...next, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

export async function prompt(ctx: Ctx, cmd: Extract<Command, { type: "thread.prompt" }>): Promise<void> {
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
  /**
   * **待切换的引擎在这一刻才真正切。**
   *
   * 用户点下拉只是说「下一句用它」（`Thread.nextEngine`）——那时停旧进程、
   * 起新进程、清模型，全都发生在他还什么都没说的时候，看起来就是莫名其妙地变了。
   *
   * 放在这里而不是更前面：上面那条「上一轮还没跑完」的路要么改向要么排队，
   * **都不该顺手把引擎换掉**；排进队的那句话之后由 `drain` 再走一遍这里，
   * 那时才切。切完 `ctx.live` 里换成了新的一条，所以递归重走一遍。
   */
  const pending = entry.thread.nextEngine
  if (pending !== undefined && pending !== entry.thread.engine) {
    await switchEngine(ctx, cmd.threadId, pending)
    return prompt(ctx, cmd)
  }
  const at = ctx.deps.now()
  commit(ctx, entry, at)
  // **有实际对话才记这一段。** 切过去没说话就切走，不该在时间线上
  // 留一条什么都没发生的记录——那样时间线会被「我点错了」填满
  void recordSegment(ctx, entry)
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
    },
  })
  await entry.session.prompt(cmd.text, turnId, cmd.attachments)
}

/**
 * 记下「这条会话在当前这家引擎那边的一段」。
 *
 * 调用时机有两个，缺一不可：
 *
 * - **第一轮开始时**（而不是切引擎时——切过去没说话不算一段）：那时段就该出现，
 *   哪怕还不知道记录在哪。
 * - **每轮收工后**：`logPath` 那时才拿得到。实测 codex 的 `thread/list`
 *   只列**已经落了 rollout 文件**的会话，而第一轮开始时它还没落——
 *   只在开头记一次的话，路径永远是空的（这个坑是拿真机跑出来的）。
 * 已经有这一家的段就只补 `logPath`（句柄不变：切回来续的就是它）。
 *
 * `logPath` 是异步问引擎的，所以整件事不 await：**它慢一点不该拖着这一轮发不出去**。
 * 拿不到就只有句柄，界面照样能显示时间线，只是少一行「记录在哪」。
 */
export async function recordSegment(ctx: Ctx, entry: Live): Promise<void> {
  const handle = entry.thread.engineHandle
  if (handle === undefined) return
  const engine = entry.thread.engine
  const path = await entry.session.logPath?.().catch(() => undefined)
  const live = ctx.live.get(entry.thread.id)
  // 等 logPath 的这一会儿会话可能已经没了
  if (live === undefined) return
  const had = live.thread.segments ?? []
  const mine = had.find((seg) => seg.engine === engine && seg.handle === handle)
  if (mine !== undefined && (path === undefined || mine.logPath === path)) return
  const at = ctx.deps.now()
  const next =
    mine === undefined
      ? [...had, { engine, handle, startedAt: at, ...(path === undefined ? {} : { logPath: path }) }]
      : had.map((seg) => (seg === mine ? { ...seg, ...(path === undefined ? {} : { logPath: path }) } : seg))
  live.thread = { ...live.thread, segments: next, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: live.thread })
}
