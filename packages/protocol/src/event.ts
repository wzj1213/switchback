import type { ItemId, ThreadId, TurnId } from "./ids.js"
import type { Item } from "./item.js"
import type { Thread, Turn, TurnStatus } from "./thread.js"

/**
 * 用量。
 *
 * **`contextUsed` 不是「累计花了多少 token」**——那是账单，不是这里要的东西。
 * 它是**最近一次请求占了多少上下文**：会话越长，每次请求带上去的历史越多，
 * 撞上窗口上限时模型会开始压缩历史、行为变差。用户需要看见的是离那条线还有多远。
 *
 * 累计消耗另有 `totalTokens`，两者不能混。
 */
export interface Usage {
  /** 最近一次请求占用的上下文 token。 */
  contextUsed: number
  /** 模型的上下文窗口。引擎没告诉我们时是 undefined——那就只显示数字，不画进度条。 */
  contextWindow?: number
  /** 本会话累计消耗，跨轮累加。 */
  totalTokens?: number
}

/**
 * 引擎 → 宿主 → 渲染层的单向事件流。
 *
 * 设计取舍：`item.updated` 携带**整条 item 的替换值**而非增量补丁。
 * item 很小，全量替换换来「渲染层永远不需要做补丁合并」——合并逻辑是状态不一致的经典来源。
 * 只有流式文本走 `item.delta`，因为那才是真正会长到不宜重发的东西。
 *
 * 事件流假设有序且不丢，序号与重放由传输层负责，不在本模型内。
 */
export type Event =
  | { type: "thread.started"; at: number; thread: Thread }
  | { type: "thread.updated"; at: number; thread: Thread }
  | { type: "turn.started"; at: number; turn: Turn }
  | { type: "turn.completed"; at: number; turnId: TurnId; status: TurnStatus; error?: string }
  | { type: "item.started"; at: number; item: Item }
  | { type: "item.delta"; at: number; itemId: ItemId; append: string }
  | { type: "item.updated"; at: number; item: Item }
  /** 上下文与消耗。引擎给什么报什么，给不出的字段就缺席。 */
  | { type: "usage.updated"; at: number; threadId: ThreadId; usage: Usage }
  /** 引擎进程本身的状态，与会话内容无关（启动、退出、崩溃、超时）。 */
  | { type: "engine.status"; at: number; threadId: ThreadId; status: EngineStatus; detail?: string }

export type EngineStatus = "starting" | "ready" | "exited" | "crashed" | "timeout"
