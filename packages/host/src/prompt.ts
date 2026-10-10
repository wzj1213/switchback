import type { Command, Item } from "@switchback/protocol"
import { switchEngine } from "./branch.js"
import { emit, isCurrent, setStatus, withQueue, type Ctx, type Live } from "./ctx.js"
import { handoffNote, withNote } from "./handoff-note.js"
import { recordSegment } from "./segment.js"
import { revive } from "./revive.js"

/**
 * 一句话怎么送到引擎。
 *
 * 从 `session.ts` 拆出来是行数闸门逼的，但这条边界本来就该有：
 * 那边回答的是**「一个会话怎么活」**（建、续、接力、分叉、删），
 * 这里回答的是**「说的这句话走哪条路」**——开新轮次、插进正在跑的那一轮、
 * 还是排队等着。三条路的取舍逻辑集中在一个文件里，才看得出它们是互斥的三选一。
 */

/** 排进队里等这一轮跑完。**队列不碰 `entry.turn`**——那条硬约束见下。 */
function queuedPrompt(cmd: Extract<Command, { type: "thread.prompt" }>): Live["queued"][number] {
  return {
    text: cmd.text,
    ...(cmd.attachments === undefined || cmd.attachments.length === 0
      ? {}
      : { attachments: cmd.attachments }),
  }
}

async function captureTurnBaseline(ctx: Ctx, entry: Live): Promise<void> {
  await ctx.deps.captureTurnBaseline?.(entry.thread.id, entry.thread.cwd)
}

function enqueue(
  ctx: Ctx,
  entry: Live,
  cmd: Extract<Command, { type: "thread.prompt" }>,
): void {
  const at = ctx.deps.now()
  entry.queued = [...entry.queued, queuedPrompt(cmd)]
  entry.thread = withQueue(consumeDraft(entry.thread, cmd.draftRevision), entry.queued, at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

function waitsForReady(entry: Live): boolean {
  return !entry.lease.active || entry.thread.status === "starting"
}

/** 目标引擎没起起来时，触发切换的第一句回到队首；不能静默改发给旧引擎。 */
function retainFailedSwitch(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.prompt" }>,
): void {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined || !isCurrent(ctx, entry)) return
  // `drainOne` 送队首时只是在尝试交付，原项一直留在队列里；切换失败不能再插一份。
  if (entry.draining !== undefined && entry.queued[0] === entry.draining) return
  const at = ctx.deps.now()
  entry.queued = [queuedPrompt(cmd), ...entry.queued]
  entry.thread = withQueue(consumeDraft(entry.thread, cmd.draftRevision), entry.queued, at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** 只消费发起命令时界面真正看见的那版草稿；无身份的旧记录保留兼容行为。 */
function consumeDraft(thread: Live["thread"], revision: string | undefined): Live["thread"] {
  const hasDraft = thread.draft !== undefined || thread.draftAttachments !== undefined
  const matches = thread.draftRevision === undefined
    ? revision === undefined
    : revision === thread.draftRevision
  if (!hasDraft || !matches) return thread
  const next = { ...thread }
  delete next.draft
  delete next.draftAttachments
  delete next.draftRevision
  return next
}

function consumeDraftAt(ctx: Ctx, entry: Live, revision: string | undefined, at: number): void {
  const consumed = consumeDraft(entry.thread, revision)
  if (consumed === entry.thread) return
  entry.thread = { ...consumed, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

function attachmentCount(cmd: Extract<Command, { type: "thread.prompt" }>): number {
  return cmd.attachments?.length ?? 0
}

/** 当前这一家明确不收附件时拒绝；待切换的先切完，再由新会话重新判定。 */
function assertAttachments(entry: Live, cmd: Extract<Command, { type: "thread.prompt" }>): void {
  if (attachmentCount(cmd) === 0) return
  const pending = entry.thread.nextEngine
  if (pending !== undefined && pending !== entry.thread.engine) return
  if (entry.thread.capabilities?.attachments === true) return
  throw new Error(`${entry.thread.engine} 不支持附件；附件仍在输入区，请移除或换一个引擎`)
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
  if (attachmentCount(cmd) > 0 && entry.thread.capabilities?.attachments !== true) return false
  try {
    await steer.call(entry.session, cmd.text, cmd.attachments)
  } catch {
    return false
  }
  // 删除或接力期间旧 session 的迟到结果不能重建日志、也不能覆盖新引擎。
  if (!isCurrent(ctx, entry)) return true
  const at = ctx.deps.now()
  consumeDraftAt(ctx, entry, cmd.draftRevision, at)
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
function commit(ctx: Ctx, entry: Live, at: number, revision: string | undefined): void {
  const consumed = consumeDraft(entry.thread, revision)
  if (entry.thread.provisional !== true && consumed === entry.thread) return
  const next = { ...consumed }
  delete next.provisional
  entry.thread = { ...next, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 把排着的话现在就插进正在跑的那一轮。
 *
 * **成功才清队列。** 反过来（先清再插）的话，插失败那几句就凭空没了——
 * 而它们往往正是「别再往下走了」，是这条路上最不能丢的东西。
 *
 * 插不进去（引擎不支持、或那一轮刚好收工）就原样留着：下一轮 `drain` 会发它。
 */
export async function steerQueued(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.steerQueued" }>,
): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  const waiting = entry.queued
  if (entry.turn === undefined || waiting.length === 0) return
  // 多句合成一段递进去：分几次 steer 的话，中间那几句可能落在不同的工具调用之间，
  // 而用户写它们时是当成一段话写的
  const text = waiting.map((prompt) => prompt.text).join("\n")
  const attachments = waiting.flatMap((prompt) => prompt.attachments ?? [])
  const ok = await steerInto(ctx, entry, {
    type: "thread.prompt",
    threadId: cmd.threadId,
    text,
    ...(attachments.length === 0 ? {} : { attachments }),
  })
  if (!ok || !isCurrent(ctx, entry)) return
  const at = ctx.deps.now()
  entry.queued = []
  entry.thread = withQueue(entry.thread, [], at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

async function sendPrompt(
  ctx: Ctx,
  entry: Live,
  cmd: Extract<Command, { type: "thread.prompt" }>,
  turnId: string,
): Promise<void> {
  try {
    await entry.session.prompt(cmd.text, turnId, cmd.attachments)
  } catch (error) {
    // RPC 连“开始”都没送进去时，引擎不会再补 completed；宿主必须把自己开的 Turn 收掉。
    if (isCurrent(ctx, entry) && entry.turn === turnId) {
      // 先摘 turn 并自行落状态：让下面的 completed 只收 renderer 那一侧，
      // 不触发 observe 的“失败轮次清空队列”。这次 RPC 根本没开始，排着的后续消息不能陪葬。
      entry.turn = undefined
      setStatus(ctx, entry, "failed")
      emit(ctx, { type: "turn.completed", at: ctx.deps.now(), turnId, status: "failed", error: String(error) })
    }
    throw error
  }
}

export async function prompt(ctx: Ctx, cmd: Extract<Command, { type: "thread.prompt" }>): Promise<void> {
  // **历史会话发话就接回来**，不再要人先点「继续」（见 `revive.ts`）。
  // 接不回来时那句话退回输入框——按下发送时输入框已经清空了
  const restore = { text: cmd.text, ...(cmd.attachments === undefined ? {} : { attachments: cmd.attachments }) }
  const entry = ctx.live.get(cmd.threadId) ?? (await revive(ctx, cmd.threadId, restore))
  // 接力握手期间第二句话先排着。旧实现会暂时把 Live 从表里删除，输入框清空后
  // 才收到“会话不存在”——这是消息丢失，不是普通报错。
  // 接管原生历史、创建与原生分叉都可能已经握手成功，但仍在收尾 starting。
  // 这时直接 prompt 会让新消息跑到待复制的旧 transcript 前面；统一排队，
  // 由各自的 ready 收尾在历史与状态完整落定后再 drain。
  if (waitsForReady(entry)) {
    enqueue(ctx, entry, cmd)
    return
  }
  assertAttachments(entry, cmd)
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
   * 3. **能改向的就当场改向**：codex 的 `turn/steer` 把话直接递进正在跑的那一轮。
   * 4. **默认排队，插入变成一个明确动作**（现在）：第 3 版和 **codex 自己的行为
   *    正好相反**——在它的界面里打字回车那句是排着的，要再点一下「调整方向」
   *    才插进去。两边不一致的代价不是别扭，是「你以为在排队的那句话，
   *    其实已经改变了它正在做的事」。所以现在只有 `cmd.steer` 为真才插，
   *    路径有两条：⌘⏎ 直接发，或者点排队条上的「立刻插入」（`thread.steerQueued`）。
   *
   * 四版都守住了那条硬约束：steer 和队列**都不碰 `entry.turn`**。
   */
  if (entry.turn !== undefined) {
    if (cmd.steer === true) {
      if (await steerInto(ctx, entry, cmd)) return
      // steer 失败的同时若已经换代，交给当前会话重新判定，不能改写旧壳。
      if (!isCurrent(ctx, entry)) return prompt(ctx, cmd)
    }
    enqueue(ctx, entry, cmd)
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
    try {
      await switchEngine(ctx, cmd.threadId, pending, true)
    } catch (error) {
      retainFailedSwitch(ctx, cmd)
      throw error
    }
    return prompt(ctx, cmd)
  }
  return startTurn(ctx, entry, cmd)
}

function userItem(
  cmd: Extract<Command, { type: "thread.prompt" }>,
  base: { id: string; turnId: string; at: number },
): Extract<Item, { kind: "user_message" }> {
  return {
    ...base,
    kind: "user_message",
    text: cmd.text,
    ...(cmd.attachments === undefined || cmd.attachments.length === 0
      ? {}
      : { attachments: cmd.attachments }),
  }
}

/**
 * 排着的那句此刻要变成转录区里的一句话：从队列里摘掉。
 *
 * 摘在这里、不等引擎确认收下：从这一刻起它只在转录区出现一次。引擎拒收的话，
 * 报错卡上有「再试一次」；要是还留在队里，同一句话界面上摆两处，点过重试之后
 * 下一轮收工 `drain` 又把它发一遍——引擎收到两份同样的话（mac2 上 Kimi 拒收大图时就是这样）。
 * 在这之前就失败的（切换回滚、接不回来、附件被拒）没进转录区，仍原位留在队首。
 */
function takeDrained(ctx: Ctx, entry: Live, at: number): void {
  const head = entry.queued[0]
  if (head === undefined || head !== entry.draining) return
  entry.queued = entry.queued.slice(1)
  entry.thread = withQueue(entry.thread, entry.queued, at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** 开一轮：转正、记分段、抓基线，发出 turn.started 与用户那句，再送给引擎。 */
async function startTurn(
  ctx: Ctx,
  entry: Live,
  cmd: Extract<Command, { type: "thread.prompt" }>,
): Promise<void> {
  commit(ctx, entry, ctx.deps.now(), cmd.draftRevision)
  // 交接说明要在记分段**之前**判定：新那家一旦落下自己那一段，就认不出这是第一句了。
  // 它要读盘；等它的这段时间里会话若被换掉、或引擎自己开了一轮，交回主路重新判定
  const note = await handoffNote(ctx, entry)
  if (!isCurrent(ctx, entry) || entry.turn !== undefined) return prompt(ctx, cmd)
  // **有实际对话才记这一段。** 切过去没说话就切走，不该在时间线上
  // 留一条什么都没发生的记录——那样时间线会被「我点错了」填满
  void recordSegment(ctx, entry)
  const turnId = ctx.deps.newId("tn")
  await captureTurnBaseline(ctx, entry)
  entry.turn = turnId
  const at = ctx.deps.now()
  const turn = {
    id: turnId,
    threadId: cmd.threadId,
    engine: entry.thread.engine,
    status: "running" as const,
    startedAt: at,
  }
  takeDrained(ctx, entry, at)
  setStatus(ctx, entry, "running")
  emit(ctx, { type: "turn.started", at, turn })
  // 交接说明原样记进转录区，排在用户那句前面——和真正送出去的顺序一致
  if (note !== undefined) {
    const item = { id: ctx.deps.newId("it"), turnId, kind: "user_message" as const, at, text: note }
    emit(ctx, { type: "item.started", at, item: { ...item, origin: "handoff" } })
  }
  emit(ctx, { type: "item.started", at, item: userItem(cmd, { id: ctx.deps.newId("it"), turnId, at }) })
  await sendPrompt(ctx, entry, { ...cmd, text: withNote(cmd.text, note) }, turnId)
}
