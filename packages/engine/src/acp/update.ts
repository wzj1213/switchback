import type { Event, ItemId, PlanStep, SlashCommand, ThreadId, ToolStatus, TurnId } from "@omni/protocol"
import { catalogOf, type Catalog } from "./setup.js"
import { merge, toToolCall } from "./translate.js"
import type { AcpCommand, AcpPlanEntry, AcpToolCall, AcpUpdate } from "./wire.js"

/**
 * `session/update` → omni 事件。
 *
 * ## 这一层存在的理由：ACP 的文本块**没有身份**
 *
 * 接第三家协议才看清的结构差别，三家各不相同：
 *
 * | | 文本怎么来 |
 * | --- | --- |
 * | Claude SDK | 整块消息，一条就是一条 |
 * | codex app-server | `item/started` 铸 id → 若干 delta → `item/completed` |
 * | ACP | **一串裸 chunk，没有 id、没有开始、没有结束** |
 *
 * `agent_message_chunk` 里只有 `content`，连个 `messageId` 都没有。
 * 所以「一条消息」这个概念在 ACP 里根本不存在，是由客户端**划**出来的：
 * 连续同类的 chunk 算一条，被工具调用或换类打断就算结束。
 * 这段划分逻辑就是本文件的 `openText` / `closeText`。
 *
 * 划错的后果很具体：不划，每个 chunk 变成一条独立 item，一段回答会碎成
 * 几十条气泡；划了但不在工具调用处收口，工具行就会插到一条尚未结束的
 * 消息中间，前后文本被拆成两半却共用一个 id。
 */
export interface UpdateContext {
  threadId: ThreadId
  /** 引擎 id。模型清单要带着「谁报的」一起走（见 store 的 `modelsOf`）。 */
  engine: string
  emit: (event: Event) => void
  /**
   * agent 自己把可选项换了。**由驱动落到自己的状态上并转发出去**——
   * 这里只负责认出这条通知、把它翻成一份清单。
   */
  onCatalog?: (catalog: Catalog) => void
  /** 宿主铸造的当前轮次 id。没有轮次就说明这条更新来得不是时候，丢弃。 */
  turnId: () => TurnId | undefined
  /**
   * 在途工具调用。
   *
   * 两个用处，缺一不可：
   * 1. `tool_call_update` 是局部补丁，要和之前的状态合并（见 `translate.ts` 的 `merge`）
   * 2. `session/request_permission` **只带 toolCallId**，命令和 diff 全在这张表里
   */
  inflight: Map<string, AcpToolCall>
  newId: (prefix: string) => string
  now: () => number
}

/** 正在攒的那条文本 item。ACP 不给 id，所以由我们自己铸一个。 */
interface OpenText {
  id: ItemId
  kind: "agent_message" | "reasoning"
  text: string
}

export interface UpdateState {
  open: OpenText | undefined
  /** 计划整条替换。同一轮里复用一个 id，界面上才是「同一份计划被改了」。 */
  planId: ItemId | undefined
}

export function createUpdateState(): UpdateState {
  return { open: undefined, planId: undefined }
}

/** 收口当前文本。**幂等**——收工清扫和工具打断都会调它。 */
export function closeText(ctx: UpdateContext, state: UpdateState): void {
  const open = state.open
  const turnId = ctx.turnId()
  state.open = undefined
  if (open === undefined || turnId === undefined) return
  ctx.emit({
    type: "item.updated",
    at: ctx.now(),
    item: { id: open.id, turnId, at: ctx.now(), kind: open.kind, text: open.text, complete: true },
  })
}

function onTextChunk(ctx: UpdateContext, state: UpdateState, update: AcpUpdate, kind: OpenText["kind"]): void {
  const text = update.content?.text
  const turnId = ctx.turnId()
  if (text === undefined || text === "" || turnId === undefined) return
  // 换了类型（正文 ↔ 思考）就是换了一条。不收口的话，两种文本会拼进同一条 item
  if (state.open !== undefined && state.open.kind !== kind) closeText(ctx, state)
  if (state.open === undefined) {
    const id = ctx.newId(kind === "reasoning" ? "think" : "msg")
    state.open = { id, kind, text: "" }
    ctx.emit({
      type: "item.started",
      at: ctx.now(),
      item: { id, turnId, at: ctx.now(), kind, text: "", complete: false },
    })
  }
  state.open.text += text
  ctx.emit({ type: "item.delta", at: ctx.now(), itemId: state.open.id, append: text })
}

function onToolCall(ctx: UpdateContext, state: UpdateState, update: AcpUpdate): void {
  const id = update.toolCallId
  const turnId = ctx.turnId()
  if (id === undefined || turnId === undefined) return
  // 工具调用打断文本：先把正在攒的那条收口，再插工具行
  closeText(ctx, state)
  const call = merge(ctx.inflight.get(id), update as AcpToolCall)
  ctx.inflight.set(id, call)
  ctx.emit({ type: "item.started", at: ctx.now(), item: toToolCall(call, turnId, ctx.now()) })
}

function onToolUpdate(ctx: UpdateContext, state: UpdateState, update: AcpUpdate): void {
  const id = update.toolCallId
  const turnId = ctx.turnId()
  if (id === undefined || turnId === undefined) return
  const prev = ctx.inflight.get(id)
  // 没见过这个 id：agent 跳过了 `tool_call` 直接发更新。照样落一条，
  // 丢掉的话界面上会缺一整个工具调用——宁可信息不全，也不能整条不见
  if (prev === undefined) {
    onToolCall(ctx, state, update)
    return
  }
  const call = merge(prev, update as AcpToolCall)
  ctx.inflight.set(id, call)
  const item = toToolCall(call, turnId, ctx.now())
  if (item.status === "ok" || item.status === "failed" || item.status === "denied") {
    ctx.inflight.delete(id)
  }
  ctx.emit({ type: "item.updated", at: ctx.now(), item })
}

const PLAN_STATUS: Readonly<Record<string, PlanStep["status"]>> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "done",
}

function toStep(entry: AcpPlanEntry): PlanStep {
  return { text: entry.content ?? "", status: PLAN_STATUS[entry.status ?? ""] ?? "pending" }
}

function onPlan(ctx: UpdateContext, state: UpdateState, update: AcpUpdate): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  closeText(ctx, state)
  const steps = (update.entries ?? []).map(toStep)
  const existing = state.planId
  const id = existing ?? ctx.newId("plan")
  state.planId = id
  ctx.emit({
    type: existing === undefined ? "item.started" : "item.updated",
    at: ctx.now(),
    item: { id, turnId, at: ctx.now(), kind: "plan", steps },
  })
}

/**
 * 上下文用量。ACP 的 `usage_update` 给的正好是 omni 要的那个数——
 * `used` 是**这次请求占了多少上下文**，不是累计账单。
 * codex app-server 那边要在 `last` 和 `total` 之间挑，这里不用挑。
 */
function onUsage(ctx: UpdateContext, update: AcpUpdate): void {
  if (update.used === undefined) return
  emitUsage(ctx, update.used, update.size)
}

/**
 * 用量事件的**唯一出口**。
 *
 * 两条路都从这里出去：协议里的 `usage_update`（上面那条），以及各家私有通知里的
 * 用量——**grok 一条 `usage_update` 都不发**，它的 token 数在
 * `_x.ai/session_notification` 里（见 `AcpDriverConfig.contextUsed`）。
 * 数从哪儿来不一样，拼出来的事件必须一样，所以拼的地方只留一处。
 *
 * 没有窗口大小就不带这个字段——界面据此只显示占用数字、不画比例条。
 * **不猜一个分母**：照猜出来的分母画出的比例，比没有比例更糟。
 */
export function emitUsage(ctx: UpdateContext, used: number, window: number | undefined): void {
  ctx.emit({
    type: "usage.updated",
    at: ctx.now(),
    threadId: ctx.threadId,
    usage: {
      contextUsed: used,
      ...(window === undefined ? {} : { contextWindow: window }),
    },
  })
}

/**
 * 一条 `AvailableCommand` → omni 的 `SlashCommand`。
 *
 * 没名字的丢掉：**这个字段就是要打进输入框的那串字**，空的话面板上会出现
 * 一条点了什么都不会发生的命令。`label` 不填——引擎报上来的命令没有人话名字
 * （`/compact` 就叫 `/compact`），协议那边说了这时退回 `name`。
 */
function toCommand(raw: AcpCommand): SlashCommand | undefined {
  const name = (raw.name ?? "").trim()
  if (name === "") return undefined
  const hint = (raw.input?.hint ?? "").trim()
  return {
    name,
    description: (raw.description ?? "").trim(),
    ...(hint === "" ? {} : { argumentHint: hint }),
    source: "engine",
  }
}

/**
 * 引擎自己认哪些斜杠命令。
 *
 * ## 为什么是「收到就发」，不像 codex 那样开场问一次
 *
 * ACP **没有「列命令」的请求方法**——agent 是在会话建好之后自己推一条
 * `available_commands_update` 过来的（实测 grok 在 `session/new` 之后推了
 * 12 条内建命令，kimi 把它认到的 skill 也一并报在这里）。
 * 什么时候推、推几次都由它定，所以开场问一次的写法必然漏：
 * 问的时候还没到，之后到了也没人接。
 *
 * `commands.updated` 本来就是「描述现状」的事件（宿主按 threadId 只留最后一条），
 * 后到的覆盖先到的正好是对的。
 */
function onCommands(ctx: UpdateContext, update: AcpUpdate): void {
  if (update.availableCommands === undefined) return
  const commands = update.availableCommands
    .map(toCommand)
    .filter((c): c is SlashCommand => c !== undefined)
  ctx.emit({ type: "commands.updated", at: ctx.now(), threadId: ctx.threadId, commands })
}

/**
 * 引擎自己换了档。
 *
 * ACP 的 mode 是**双向**的：客户端能设，agent 也能自己切（比如 `/review`
 * 这类内建命令会切到只读）。不报出来的话，omni 界面上显示的档位会和
 * 引擎实际在用的档位悄悄分家。
 */
function onModeChanged(ctx: UpdateContext, update: AcpUpdate): void {
  if (update.currentModeId === undefined) return
  ctx.emit({
    type: "engine.status",
    at: ctx.now(),
    threadId: ctx.threadId,
    status: "ready",
    detail: `引擎把档位切到了 ${update.currentModeId}。`,
  })
}

/**
 * agent 那边的可选项变了。
 *
 * **换模型之后强度的词表是会变的**：实测 ZCode 的 GLM-5.3 有 low/high/max，
 * 换到 GLM-5-Turbo 之后一个都没有。不接这条通知的话，界面上还摆着
 * 上一个模型才有的强度档，点下去引擎直接报错——又是一个会撒谎的控件。
 *
 * 和 `available_commands_update` 同一条路子：**引擎自己报的，就以它为准。**
 */
function onConfigOptions(ctx: UpdateContext, update: AcpUpdate): void {
  if (update.configOptions === undefined) return
  ctx.onCatalog?.(catalogOf({ configOptions: update.configOptions }))
}

/**
 * 轮次收工时清扫还挂着的工具调用。
 *
 * 和 codex 驱动同一个教训：中断时 agent 不会给在途的工具补一条完成更新，
 * 不扫的话界面上留下一条**永远转下去**的工具行。
 */
export function sweep(ctx: UpdateContext, state: UpdateState, ending: ToolStatus): void {
  const turnId = ctx.turnId()
  closeText(ctx, state)
  state.planId = undefined
  if (turnId === undefined) {
    ctx.inflight.clear()
    return
  }
  for (const call of ctx.inflight.values()) {
    const item = toToolCall(call, turnId, ctx.now())
    if (item.status === "ok" || item.status === "failed") continue
    ctx.emit({ type: "item.updated", at: ctx.now(), item: { ...item, status: ending } })
  }
  ctx.inflight.clear()
}

/** 认不出的更新静默丢弃——协议一直在加新类型，多一种不该掀翻会话。 */
export function handleUpdate(ctx: UpdateContext, state: UpdateState, update: AcpUpdate): void {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return onTextChunk(ctx, state, update, "agent_message")
    case "agent_thought_chunk":
      return onTextChunk(ctx, state, update, "reasoning")
    // 用户消息宿主在发 prompt 时已经自己发过了，引擎回声的这条丢掉，
    // 否则界面上会出现两条一模一样的用户消息
    case "user_message_chunk":
      return
    case "tool_call":
      return onToolCall(ctx, state, update)
    case "tool_call_update":
      return onToolUpdate(ctx, state, update)
    case "plan":
      return onPlan(ctx, state, update)
    case "usage_update":
      return onUsage(ctx, update)
    case "available_commands_update":
      return onCommands(ctx, update)
    case "current_mode_update":
      return onModeChanged(ctx, update)
    case "config_option_update":
      return onConfigOptions(ctx, update)
    default:
      return
  }
}
