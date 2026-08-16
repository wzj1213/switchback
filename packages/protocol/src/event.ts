import type { EngineId, ItemId, ThreadId, TurnId } from "./ids.js"
import type { Item } from "./item.js"
import type { SlashCommand, Thread, Turn, TurnStatus } from "./thread.js"

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
 * 一个可选的模型。
 *
 * `efforts` **只有引擎真能在运行期改推理强度时才填**。Claude 的 effort 是
 * `Options` 字段，改它要重启会话——所以它不填，界面上也就不会出现一个
 * 点了没用的控件。
 */
export interface ModelOption {
  id: string
  label: string
  description?: string
  efforts?: readonly string[]
  defaultEffort?: string
}

/**
 * 一个可用的引擎。**清单由宿主给**——界面写死一份，迟早和真正注册了的对不上。
 *
 * `state` 回答「这台机器上装了吗」，三态：
 *
 * | | 界面怎么做 |
 * | --- | --- |
 * | `ok` | 正常显示 |
 * | `missing` | 标出来并说清楚怎么装。**仍然可选**——探测也会错，不能硬拦 |
 * | `unknown` / 缺席 | 什么都不做。**猜不出来就别猜** |
 *
 * 灰掉一个其实能用的引擎，比不检查更糟：用户会相信自己没装，去装第二遍。
 */
export interface EngineInfo {
  id: EngineId
  label: string
  state?: "ok" | "missing" | "unknown"
  /** `missing` 时给人看的一句话，必须说得出下一步做什么。 */
  detail?: string
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
  /** 宿主启动时报一次：这台机器上装了哪些引擎。 */
  | { type: "engines.available"; at: number; engines: readonly EngineInfo[] }
  | { type: "thread.started"; at: number; thread: Thread }
  | { type: "thread.updated"; at: number; thread: Thread }
  | { type: "thread.removed"; at: number; threadId: ThreadId }
  /**
   * 改名了。
   *
   * 不复用 `thread.updated`（它带整个 `Thread`）是因为**历史会话不在宿主手上**——
   * 宿主只有活着的那些，而回放出来的会话只存在于渲染层的 store 里。
   * 只发「哪个 id 改成什么名」，两边都能应用，落盘之后重放也还在。
   */
  | { type: "thread.renamed"; at: number; threadId: ThreadId; title: string }
  | { type: "turn.started"; at: number; turn: Turn }
  | { type: "turn.completed"; at: number; turnId: TurnId; status: TurnStatus; error?: string }
  | { type: "item.started"; at: number; item: Item }
  | { type: "item.delta"; at: number; itemId: ItemId; append: string }
  | { type: "item.updated"; at: number; item: Item }
  /** 这个会话能选哪些模型。引擎握手完成后报一次。 */
  | { type: "models.updated"; at: number; threadId: ThreadId; models: readonly ModelOption[] }
  /**
   * 这个会话能用哪些斜杠命令。握手后报一次；
   * Claude 那边技能会**中途变**（agent 走到子目录里发现新技能），所以还会再报。
   */
  | { type: "commands.updated"; at: number; threadId: ThreadId; commands: readonly SlashCommand[] }
  /** 上下文与消耗。引擎给什么报什么，给不出的字段就缺席。 */
  | { type: "usage.updated"; at: number; threadId: ThreadId; usage: Usage }
  /**
   * 账号额度用到哪儿了。引擎每轮推一次。
   *
   * **不挂在会话上**：额度是账号级的，同一家引擎的所有会话共享一份。
   * 挂到会话上就会出现「这个会话说还剩 20%、那个说还剩 80%」。
   */
  | { type: "limits.updated"; at: number; engine: EngineId; limits: RateLimits }
  /** 引擎进程本身的状态，与会话内容无关（启动、退出、崩溃、超时）。 */
  | { type: "engine.status"; at: number; threadId: ThreadId; status: EngineStatus; detail?: string }

/**
 * `degraded` 是**引擎还活着、但掉了一部分能力**。
 *
 * 加这一档是因为 MCP 服务器起不来：codex 照跑不误，只是那台服务器的工具
 * 全都不在了。报 `crashed` 是撒谎（引擎好好的），不报又是最坏的一种——
 * agent 少了几十个工具，你只会看到它「做得不太行」，而不知道为什么。
 */
export type EngineStatus = "starting" | "ready" | "exited" | "crashed" | "timeout" | "degraded"

/**
 * 账号额度。
 *
 * 字段名沿用 codex app-server 协议（`primary` / `secondary` 各带 `usedPercent`、
 * `windowDurationMins`、`resetsAt`）——**这不是我编的形状**。
 *
 * 两个窗口的含义：一般 `primary` 是长周期（比如周），`secondary` 是短周期
 *（比如 5 小时）。**该报警的是更紧的那个**，不一定是数值大的那个。
 */
export interface RateLimits {
  primary?: RateWindow
  secondary?: RateWindow
}

export interface RateWindow {
  /** 已用百分比。0–100，可能超过 100。 */
  usedPercent: number
  /** 这个窗口有多长（分钟）。用来说「5 小时内」还是「本周」。 */
  windowDurationMins?: number
  /** 什么时候重置。ISO 字符串。 */
  resetsAt?: string
}
