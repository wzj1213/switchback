import type { EngineId, ItemId, ThreadId, TurnId } from "./ids.js"
import type { Item } from "./item.js"
import type { Lane } from "./lane.js"
import type { EngineAccount, EngineThread, SlashCommand, Thread, Turn, TurnPace, TurnStatus } from "./thread.js"

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
  /**
   * 最近一次请求里**模型自己生成了多少 token**。
   *
   * 和上面每一项都不是一类：那几项回答「占了多少、花了多少钱」，这一项回答
   * **「它吐了多少」**——业界口径的 token/s，分子只能是它。
   * 拿字节去估的话，同一个真实速度，答英文和答中文的读数会差出四分之一
   *（一个 token 在英文里约 4 字节，在中文里约 3 字节却常一字一 token）。
   *
   * **报得上来才有**：claude / kimi / grok 报；codex 只给 input+output 合一的
   * `last.totalTokens`，通用 ACP 只给 `used`——那两家这里缺席，
   * 界面据此退回按字节估、并在数字前打上波浪号。
   *
   * 不拿 `totalTokens` 减去上一次的 input 去凑：一轮里可能有好几次请求、
   * 历史每次都在变，凑出来的数比没有更糟。
   */
  outputTokens?: number
  /**
   * 最近一次请求里**命中缓存读到的 token**。它省的是钱不是上下文——
   * 照样算进 `contextUsed`，这里只是单独再说一遍。
   * 照 `contextWindow` 的规矩：引擎报了才有，没报就是 undefined，界面上不出现。
   */
  cacheRead?: number
}

/**
 * 一个可选的模型。
 *
 * `efforts` **只有引擎真能在运行期改推理强度时才填**。例如当前 Claude SDK
 * 会按模型报告 `supportedEffortLevels`，并由 `applyFlagSettings` 在运行期应用；
 * 报不出清单或没有可用 setter 的引擎就不填，界面也不会画一个点了没用的控件。
 */
/**
 * 一个正在跑的**子 agent / 后台任务**。
 *
 * ## 为什么是活状态，不落盘
 *
 * 和 `usage` 同一类：它描述的是「此刻」，而不是「发生过什么」。落盘之后重放出来
 * 是一串**早就跑完了的任务还显示在跑**——比没有更糟。轮次一结束就清掉。
 *
 * ## 每个字段都是引擎给的，Switchback 一个字都不编
 *
 * 实测 claude 的 `system/task_progress` 一帧：
 * `{description:"Reading b.txt", subagent_type:"general-purpose",
 *   last_tool_name:"Read", usage:{tool_uses:3, duration_ms:4186}}`。
 * `description` 是**它自己写的一句人话**——Switchback 拿现成的，不从工具名拼一句出来。
 */
export interface TaskRun {
  id: string
  /** 引擎写的一句人话。没有就不显示这一条——**不拿工具名拼一句顶替**。 */
  description: string
  /** 子 agent 的类型名（claude 的 `general-purpose` 之类）。报不上来就缺席。 */
  agentType?: string
  /** 它最近用的那个工具。 */
  lastTool?: string
  toolUses: number
  ms: number
}

export interface ModelOption {
  id: string
  label: string
  description?: string
  efforts?: readonly string[]
  defaultEffort?: string
  /** 引擎为这一模型明确公布的输入模态；缺席表示旧目录没有上报，不能据此禁用。 */
  inputModalities?: readonly ("text" | "image" | "audio")[]
  /**
   * 引擎自己认的默认模型。
   *
   * 界面靠它做「恢复默认设置」——没有这一条的话那句话是空的：
   * Switchback 不知道该退回到哪个模型。codex 的 `model/list` 报 `isDefault`（实测）。
   */
  isDefault?: boolean
}

/**
 * 一个可用的引擎。**清单由宿主给**——界面写死一份，迟早和真正注册了的对不上。
 *
 * `state` 回答「这台机器上的运行入口当前能否用」，四态：
 *
 * | | 界面怎么做 |
 * | --- | --- |
 * | `ok` | 正常显示 |
 * | `missing` | 标出来并说清楚怎么装。**仍然可选**——探测也会错，不能硬拦 |
 * | `unavailable` | 命令已安装，但当前原生配置/插件组装不能启动 |
 * | `unknown` / 缺席 | 什么都不做。**猜不出来就别猜** |
 *
 * 灰掉一个其实能用的引擎，比不检查更糟：用户会相信自己没装，去装第二遍。
 */
export interface EngineInfo {
  id: EngineId
  label: string
  /** 这份探测结果属于哪条原生 profile；目前由 DSH 使用。 */
  profile?: string
  state?: "ok" | "missing" | "unavailable" | "unknown"
  /** `missing` / `unavailable` 时给人看的一句话，必须说得出下一步做什么。 */
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
/** 引擎原生通知队列的优先级。顺序与名字都由引擎给，宿主不自行改判严重程度。 */
export type EngineNotificationPriority = "low" | "medium" | "high" | "immediate"

export type Event =
  /** 全量重建必带；用户改变引擎接入范围时再增量更新。 */
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
  /** `pace`：宿主量的这一轮出字节奏（见 `TurnPace`）。量不出来、或者是抄过来的历史时缺席。 */
  | { type: "turn.completed"; at: number; turnId: TurnId; status: TurnStatus; error?: string; pace?: TurnPace }
  | { type: "item.started"; at: number; item: Item }
  | {
      type: "item.delta"
      at: number
      itemId: ItemId
      append: string
      /**
       * 通常终态 `item.updated` 会整条落盘，增量只需直播；没有后续整条快照的原生流
       *（例如 Grok 后台监控输出）带上会话身份，让宿主能把增量写进正确 journal。
       */
      threadId?: ThreadId
    }
  | { type: "item.updated"; at: number; item: Item }
  /**
   * 引擎明确撤回一条已发出的 item。带 turnId 让宿主能在重铸 item id 之后仍精确落盘；
   * 未知或已经移除的 id 是幂等空操作，后续更新也不得把它复活。
   */
  | { type: "item.removed"; at: number; turnId: TurnId; itemId: ItemId }
  /**
   * 一条旁路的当前样子。**upsert，全量替换**，同 id 覆盖。
   *
   * 不分 started / updated 两条：各家「起」和「改」的边界不一样
   *（claude 的 `task_started` 与 `workflow_progress` 是两条消息，
   * grok 的 `WorkflowUpdated` 第一条就是全量快照），分成两条就要让每个驱动
   * 自己记「我是不是第一次报这条」——那正是驱动最不该操心的事。
   * item 那边分三条是因为有流式文本要追加；Lane 没有流式内容
   *（它的内容以带 `lane` 的 item 形式走 item 那条路）。
   *
   * **落盘**（它是内容，不是进程状态），**不进 `LIVE_STATE`**（落了盘，重放能回来）。
   */
  | { type: "lane.updated"; at: number; threadId: ThreadId; lane: Lane }
  /**
   * 这个会话能选哪些模型。引擎握手完成后报一次。
   *
   * **`engine` 不是冗余的**：模型 id 是各家私有的，而一条会话中途会换引擎。
   * 不带这一条的话，切过去之后新那家一个模型都报不上来时（`models()` 失败就是空），
   * 界面上留着的是**上一家的清单**——点一下就拿 claude 的模型 id 去设给 codex。
   * 带上它，渲染层就能判「这份清单是谁报的」，对不上就当没有。
   */
  | { type: "models.updated"; at: number; threadId: ThreadId; engine: EngineId; models: readonly ModelOption[] }
  /**
   * 这个会话能用哪些斜杠命令。握手后报一次；
   * Claude 那边技能会**中途变**（agent 走到子目录里发现新技能），所以还会再报。
   * `engine` 用来挡住接力前一家留下的旧清单，理由同上面的模型事件。
   */
  | {
      type: "commands.updated"
      at: number
      threadId: ThreadId
      engine: EngineId
      commands: readonly SlashCommand[]
    }
  /** 引擎自己存着哪些会话（你在终端、在别的界面里跑过的）。 */
  | { type: "engine.history"; at: number; engine: EngineId; threads: readonly EngineThread[] }
  /** 引擎登录的是哪个账号。额度算在谁头上，看这个。 */
  | { type: "account.updated"; at: number; engine: EngineId; account: EngineAccount }
  /** 上下文与消耗。带来源引擎，接力后不会把上一家的窗口数字画到新一家上。 */
  | { type: "usage.updated"; at: number; threadId: ThreadId; engine: EngineId; usage: Usage }
  /** 新原生会话尚未上报用量；清掉同引擎上一条已销毁会话留下的数字。 */
  | { type: "usage.cleared"; at: number; threadId: ThreadId; engine: EngineId }
  /**
   * 当前轮的近似思考 token。**只用于运行期进度，不是账单，也不落盘。**
   *
   * `estimatedTokens` 缺席表示这一段思考已经结束；带 `turnId` 是为了挡住上一轮
   * 迟到的进度，不能让它覆盖下一轮的状态。
   */
  | { type: "thinking.updated"; at: number; threadId: ThreadId; turnId: TurnId; estimatedTokens?: number }
  /**
   * 这条会话此刻有哪些子 agent 在跑。**整份替换**，空数组 = 一个都没有。
   *
   * 全量而不是增量：一次只报一条的话，「它跑完了」就得再发明一种「删除」事件，
   * 而漏发一次的后果是界面上留一条**永远在跑**的任务。全量替换没有这个失败模式。
   */
  | { type: "tasks.updated"; at: number; threadId: ThreadId; tasks: readonly TaskRun[] }
  /**
   * 账号额度用到哪儿了。引擎每轮推一次。
   *
   * **不挂在会话上**：额度是账号级的，同一家引擎的所有会话共享一份。
   * 挂到会话上就会出现「这个会话说还剩 20%、那个说还剩 80%」。
   *
   * **窗口是稀疏更新**：只带 primary 或 secondary 时仅替换该窗口，另一窗口保留；
   * 空对象表示引擎明确要求清掉已知额度。Codex 与 Claude 都会逐窗口推送，不能把缺席
   * 误当删除，否则两种周期会在界面上互相顶掉。
   */
  | { type: "limits.updated"; at: number; engine: EngineId; limits: RateLimits }
  /**
   * 引擎要求宿主展示的一次性通知。它不是模型正文，也不代表能力损失，因此不落盘。
   * `key` 用于原地替换同一条原生通知；`timeoutMs` 缺席时由用户手动关闭。
   */
  | {
      type: "engine.notification"
      at: number
      threadId: ThreadId
      engine: EngineId
      key: string
      message: string
      priority: EngineNotificationPriority
      color?: string
      timeoutMs?: number
    }
  /**
   * Switchback 的外发守卫看见一个进程在往本机外面**批量**发数据（见 desktop 的 `egress-*.ts`）。
   *
   * 不是引擎自报的状态，是 Switchback 自己量的——所以单独一类，不混进 `engine.status`。
   * `threadId` 是那个引擎所在的会话；不是 Switchback 起的进程（比如单独开着的 ZCode）时是空串。
   * `stopped`：Switchback 已经按设置把它停掉了。不落盘：它说的是「刚才」，重放出来只是一条过期的警报。
   */
  | { type: "egress.alert"; at: number; threadId: ThreadId; detail: string; stopped: boolean }
  /** 引擎进程本身的状态，与会话内容无关（启动、退出、崩溃、超时）。 */
  | {
      type: "engine.status"
      at: number
      threadId: ThreadId
      status: EngineStatus
      detail?: string
      /**
       * 说的是哪一家。只有 `unauthenticated` 带：开会话失败时会话已经撤了，
       * 界面要靠它在「那一家登录成功」之后收起这条横幅。
       */
      engine?: EngineId
    }

/**
 * `degraded` 是**引擎还活着、但掉了一部分能力**。
 *
 * 加这一档是因为 MCP 服务器起不来：codex 照跑不误，只是那台服务器的工具
 * 全都不在了。报 `crashed` 是撒谎（引擎好好的），不报又是最坏的一种——
 * agent 少了几十个工具，你只会看到它「做得不太行」，而不知道为什么。
 *
 * `unauthenticated` 是**引擎明确说了「要先登录」**（ACP 的 `-32000`）：进程好好的，
 * 只是这一步它不肯做。同样不能报成 `crashed`——那会把人引去查一个没坏的东西；
 * 下一步是登录，界面据此直接给出去登录的路。
 *
 * `reconnecting` 是**驱动和引擎之间的实时连接断了、正在自己接回来**：不是故障，也不是能力损失，
 * 人什么都不用做。界面不为它弹横幅，只在这一轮的状态行里安静地说一句；
 * 同一条会话下一次报别的状态（通常是 `ready`）就把它收起。真接不回来时驱动另报 `crashed`。
 */
export type EngineStatus =
  | "starting" | "ready" | "exited" | "crashed" | "timeout" | "degraded" | "unauthenticated" | "reconnecting"

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
