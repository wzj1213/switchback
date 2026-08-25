import type { ItemId, TurnId } from "@omni/protocol"
import type { Event } from "@omni/protocol"

/**
 * 逐字那一路：把 SDK 的 `stream_event` 翻成 `item.delta`。
 *
 * ## 在这之前 claude 一条 delta 都不发
 *
 * 实测（2026-08-25，CLI 2.1.245）：跑一句「数到 40」，omni 收到的是
 * **一条 `item.started`，`text` 里已经是整段答案**，然后 `usage.updated`、
 * `turn.completed`——总共四条事件，`item.delta` 零条。
 *
 * 两处各缺一半：`Options.includePartialMessages` 从来没设过，所以 SDK 压根不发
 * `stream_event`；而 `loop.ts` 的 `dispatch` 里也没有这一支，发了也会被丢掉。
 *（`packages/engine/README.md` 当时写着「驱动只翻译 assistant / stream_event /
 * result / system 四类」——那句话里的 `stream_event` 是不存在的。）
 *
 * 后果不止是「没有打字机效果」：**桌宠在 claude 会话上永远不开火**（流速恒为 0）、
 * 打靶那张靶永远读 0 t/s——那一整层的输入就是 `item.delta`。
 *
 * ## 身份怎么对齐：复用同一个 id
 *
 * 一条消息会经过两遍：先是一串 `stream_event`，最后是一条完整的 `assistant`。
 * 两遍如果各铸各的 id，转录区里就会**留下两条一模一样的消息**。
 *
 * 好在 store 的归约器对 `item.started` 是**按 id 幂等**的（`reduce.ts` 里那段：
 * 「`item.started` 重复不再长出两条一样的 item」）——所以只要收尾那条复用
 * 流式那条的 id，它就是原地替换，连 `item.updated` 都不需要。
 *
 * ## 为什么按「第几个说出来的块」对齐，而不是原始下标
 *
 * `onAssistant` 会先把待办工具滤掉再翻译（`isPlanTool`），一滤下标就错位了。
 * 而滤掉的全是 `tool_use` 块，**不影响 text / thinking 之间的相对顺序**——
 * 所以两边都数「这是第几个说出来的块」，对齐就稳。
 *
 * ## 为什么第一条 delta 到了才建 item
 *
 * `content_block_start` 一定先于内容到达，那时块还是空的。照它建 item 的话，
 * 一个最终什么都没吐的块会在转录区里留下一条**永远空着的消息**。
 * 所以开始时只记下「这个下标是什么 kind」，等第一条 delta 才真的建。
 */

/** 我们认的那几个流式事件形状。**认不出的一律忽略**——这条流上还有十几种。 */
export interface RawStreamEvent {
  type?: string
  index?: number
  content_block?: { type?: string }
  delta?: { type?: string; text?: string; thinking?: string }
}

/** 说得出来的那两种块。工具调用不走这条路——见 `onStreamEvent`。 */
type Spoken = "agent_message" | "reasoning"

export interface StreamState {
  /** 这条消息里已经见过几个「说出来的」块。收尾那条靠它对齐。 */
  said: number
  /** 原始 block 下标 → item id。delta 靠它找到自己那条。 */
  byIndex: Map<number, ItemId>
  /** 第几个说出来的块 → item id。**收尾那条消息复用它**。 */
  byOrder: Map<number, ItemId>
  /**
   * 这个下标的块是什么 kind、是第几个说出来的。**记下但先不建**，见文件头最后一段。
   *
   * 序号在这里就定死，不等到建 item 时再拿 `said` 现算：现算的写法依赖
   * 「块是严格一个接一个来的」，而那是这条流现在的样子，不是它承诺的样子。
   */
  kindAt: Map<number, { kind: Spoken; order: number }>
}

export function createStream(): StreamState {
  return { said: 0, byIndex: new Map(), byOrder: new Map(), kindAt: new Map() }
}

/**
 * 一条消息说完了（或者新的一条要开始了）：把这条消息的流式状态清空。
 *
 * **一轮里可能有好几条 assistant 消息**（每次工具往返之后都会再来一条），
 * 不清的话第二条的「第几个说出来的块」会接着第一条数，收尾时对齐到别人的 id 上。
 */
export function resetStream(state: StreamState): void {
  state.said = 0
  state.byIndex.clear()
  state.byOrder.clear()
  state.kindAt.clear()
}

function spokenOf(type: string | undefined): Spoken | undefined {
  if (type === "text") return "agent_message"
  if (type === "thinking") return "reasoning"
  return undefined
}

/** 一条 delta 里的文字。文本块和思考块各放各的字段。 */
function textOf(delta: RawStreamEvent["delta"]): string {
  if (delta === undefined) return ""
  if (delta.type === "text_delta") return delta.text ?? ""
  if (delta.type === "thinking_delta") return delta.thinking ?? ""
  // `input_json_delta`（工具入参）与 `signature_delta` 有意不接：
  // 前者要等参数拼全才有意义（审批卡靠它），后者不是给人看的
  return ""
}

export interface StreamContext {
  turnId: TurnId
  at: number
  /** 铸一个新 item id。**和收尾那条用的是同一个铸币机**，序号不会撞。 */
  nextId: () => ItemId
  emit: (event: Event) => void
}

/** 吃一条流式事件。认不出的形状一律什么都不做。 */
export function onStreamEvent(
  state: StreamState,
  event: RawStreamEvent | undefined,
  ctx: StreamContext,
): void {
  if (event === undefined) return
  if (event.type === "message_start") {
    resetStream(state)
    return
  }
  if (event.type === "content_block_start") {
    const kind = spokenOf(event.content_block?.type)
    // 工具调用不走这条路：它的 id 要复用 Claude 自己的 `tool_use` id（审批卡靠它挂），
    // 而入参要等拼全才有意义。那条照旧由 `onAssistant` 整块处理
    if (kind === undefined || event.index === undefined) return
    state.kindAt.set(event.index, { kind, order: state.said })
    state.said += 1
    return
  }
  if (event.type === "content_block_delta") onDelta(state, event, ctx)
}

function onDelta(state: StreamState, event: RawStreamEvent, ctx: StreamContext): void {
  const index = event.index
  if (index === undefined) return
  const text = textOf(event.delta)
  if (text === "") return
  const id = state.byIndex.get(index) ?? open(state, index, ctx)
  if (id === undefined) return
  ctx.emit({ type: "item.delta", at: ctx.at, itemId: id, append: text })
}

/**
 * 第一条 delta 到了，这才把 item 建出来。
 *
 * 建成空的再由 delta 填：**不能把第一段文字直接塞进 `item.started`**——
 * 流速那一层只数 `item.delta` 的字节（`flow-scope.ts`），塞进去的那段就漏计了。
 */
function open(state: StreamState, index: number, ctx: StreamContext): ItemId | undefined {
  const started = state.kindAt.get(index)
  if (started === undefined) return undefined
  const id = ctx.nextId()
  state.byIndex.set(index, id)
  state.byOrder.set(started.order, id)
  ctx.emit({
    type: "item.started",
    at: ctx.at,
    item: { id, turnId: ctx.turnId, at: ctx.at, kind: started.kind, text: "", complete: false },
  })
  return id
}
