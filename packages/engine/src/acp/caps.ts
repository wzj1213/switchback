import type {
  EngineNotificationPriority,
  Lane,
  NoticeLevel,
  QuestionPrompt,
  QuestionResponse,
  ToolCallItem,
  Trust,
  TurnId,
  UserMessageOrigin,
} from "@omni/protocol"
import type { ReclaimConfig } from "../subprocess.js"

export interface ForeignNotice {
  message: string
  level: NoticeLevel
}

/** 不属于某一轮的原生会话提示；即使开场尚无 turn 也必须让用户看见。 */
export interface ForeignNotification {
  key: string
  message: string
  priority: EngineNotificationPriority
  color?: string
  timeoutMs?: number
}

export type ForeignActivity = Pick<Lane, "id" | "title" | "status" | "summary" | "progress" | "handle">
/** 原生活动附带的工具输出增量；item 身份仍由宿主按会话重铸。 */
export interface ForeignActivityOutput {
  itemId: string
  append: string
}
export type ForeignActivityUpdate = ForeignActivity | ForeignActivityOutput
export type ForeignActivityParser = (method: string, params: unknown) => ForeignActivityUpdate | undefined
export type ForeignTool = Pick<ToolCallItem, "tool" | "status" | "detail" | "error"> & { promptId?: string }
export type ForeignToolParser = (method: string, params: unknown) => readonly ForeignTool[] | undefined

/** 私有通知明确要求宿主发起的原生轮；正文只能来自引擎，不由宿主补提示词。 */
export interface ForeignTurn {
  /** 同一触发仍在排队或运行时的去重键；下一次触发在本轮收工后可以复用。 */
  key: string
  prompt: string
  origin?: UserMessageOrigin
  /** 引擎公开的轮次关联扩展；只放标识，不进入模型正文。 */
  promptMeta?: (turnId: TurnId) => Readonly<Record<string, unknown>> | undefined
}

export type ForeignTurnParser = (method: string, params: unknown) => ForeignTurn | undefined

/** 引擎私有反向请求明确交给宿主呈现的问题；回答仍按该引擎自己的 wire 形状回送。 */
export interface ForeignInteraction {
  sessionId: string
  /** 原生 interaction 身份；用于多客户端 first-answer-wins 撤销宿主卡。 */
  key: string
  questions: readonly QuestionPrompt[]
  reply: (response: QuestionResponse) => unknown
}

export type ForeignInteractionParser = (method: string, params: unknown) => ForeignInteraction | undefined
export type ForeignInteractionResolvedParser = (method: string, params: unknown) => string | undefined

/** 厂商公开的 ACP 扩展请求；方法名与参数形状都由该厂商适配器负责。 */
export interface ForeignCall {
  method: string
  params: unknown
}

/** 厂商原生插话入口。标准 `session/steer` 仍由通用驱动自己组装。 */
export type ForeignSteer = (sessionId: string, text: string) => ForeignCall

/** 厂商原生完整分叉入口。分出句柄后通用驱动会用标准 `session/load` 接入。 */
export interface ForeignFork {
  request: (sourceSessionId: string, cwd: string) => ForeignCall
  handle: (response: unknown) => string | undefined
}

/**
 * 一家 ACP 引擎的**注入面**：驱动这一层不认识任何一家，各家的特殊之处从这里递进来。
 *
 * 单独一个文件是因为它不是驱动的实现细节，而是**驱动与各家适配模块之间的契约**
 *（`kimi.ts` / `grok.ts` / `registry.ts` 都照着它填）。放在 driver.ts 里，
 * 读的人得先翻过两百行会话逻辑才看得到「我该提供什么」。
 */
export interface AcpDriverConfig {
  /** 引擎身份，落进事件与判定请求。约定用 `acp:` 前缀，如 `acp:zcode`。 */
  id: string
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  reclaim?: Partial<ReclaimConfig>
  /** 引擎公开的 prompt 关联扩展；只放标识，不向模型上下文写宿主文字。 */
  promptMeta?: (turnId: TurnId) => Readonly<Record<string, unknown>> | undefined
  /**
   * 这家把会话记录写到哪。**注入进来而不是驱动自己认**：
   * ACP 协议里根本没有「记录在哪」这个概念，各家各写各的
   * （kimi 的在 `kimi.ts`，grok 的在 `grok.ts`），驱动这一层不该认识
   * 任何一家的目录结构。
   *
   * `cwd` 也一并给出去：有的家**按工作区分目录**（grok 的记录在
   * `sessions/<工作区编码>/<sessionId>/` 下），光有 sessionId 定位不到；
   * 不需要的那家（kimi 查自己的索引）少收一个参数就行。
   *
   * 不给就是拿不到——时间线据实不提供原始记录入口，不由宿主编摘要补齐。
   */
  logPath?: (home: string, sessionId: string, cwd: string) => Promise<string | undefined>
  /**
   * 这家怎么报上下文用量——**只用于协议之外的私有通知**。
   *
   * 标准路子是 `session/update` 的 `usage_update`，那条驱动自己认（实测 kimi
   * 一轮收工推一条 `{used, size}`）。但不是每家都走它：**grok 一条 `usage_update`
   * 都不发**，用量藏在它自己的 `_x.ai/session_notification` 里
   *（`turn_completed` 带 `usage.totalTokens`）。
   *
   * 认这类通知是一家一家的事，所以和 `logPath` 同一个办法注入进来，
   * 驱动这一层不认识任何一家的私有方法名。返回 undefined = 这条通知与用量无关。
   */
  contextUsed?: (method: string, params: unknown) => number | undefined
  /**
   * 同一条私有通知里的缓存命中（只取 read——creation 是写缓存，不是命中）。
   * 和 `contextUsed` 同一条路、同一个理由：协议里没有，各家各报各的。
   * 返回 undefined = 这条通知与用量无关 / 没报——**没报就不显示，不拿 0 冒充没命中**。
   */
  cacheRead?: (method: string, params: unknown) => number | undefined
  /**
   * 这一轮**生成了多少 token**。和上面两条同一条路、同一个理由：协议里没有，
   * 各家各报各的。报得上来界面才敢把 t/s 当真数显示（见 `Usage.outputTokens`）。
   */
  outputTokens?: (method: string, params: unknown) => number | undefined
  /**
   * 这家用私有通知发给人的原文。只接 agent 明确暴露的提示，不从状态猜文案。
   * 返回 undefined = 这条通知不该进入 transcript。
   */
  notice?: (method: string, params: unknown) => ForeignNotice | undefined
  /** 私有通道上的会话级提示；与 transcript notice 分开，避免硬挂到错误轮次。 */
  notification?: (method: string, params: unknown) => ForeignNotification | undefined
  /** 私有通道上已经收口的工具结果；驱动只补宿主 id / turn，不解释一家字段。 */
  toolItems?: ForeignToolParser
  /** 每条原生会话独享的私有活动解析器；同一个 id 的后到快照替换先到状态。 */
  activity?: () => ForeignActivityParser
  /** 私有通知明确要求当前客户端驱动的新一轮；忙时由通用驱动排队，同一触发只跑一次。 */
  nativeTurn?: ForeignTurnParser
  /** 私有 blocking reverse-request；只有引擎明确公开给客户端的形状才在各自适配器认领。 */
  interaction?: ForeignInteractionParser
  /** 同一 interaction 被其他原生客户端先回答时，用原生终态撤销本地等待。 */
  interactionResolved?: ForeignInteractionResolvedParser
  /**
   * 这家的**原生审批开关**怎么按信任档设。
   *
   * ACP 的标准做法是 mode（`session/set_mode`），但不是每家都实现：
   * Grok 1.0.5 的审批不在 mode 表里，而在 `session/new` / `session/load` 的
   * `_meta.autoMode` 与 `_meta.yoloMode`。前者接分类器 Auto，后者接 Always-approve。
   *
   * `meta` 并进会话开场的 `_meta`；`note` 可替掉「没报告可选档位」那句通用文案。
   *
   * **只在开会话时生效**：不同值由 `setTrust` 请求续接同一个原生会话重启，
   * 不先写一个尚未生效的新档位。
   */
  nativeApproval?: (trust: Trust) => { meta?: Readonly<Record<string, unknown>>; note?: string }
  /**
   * 这家会不会主动推 `current_mode_update`（见 `EngineCapabilities.modeReadback`）。
   *
   * **协议里没有对应的声明**，握手推不出来，所以只能一家一家给。
   * **默认 false**：不知道就别声称——报 true 而实际不推的代价是界面上那行
   *「引擎侧：X」永远停在开场那一刻，而它长得像实时的。
   */
  modeReadback?: boolean
  /**
   * 这家认不认 `session/compact` / `session/steer`。
   *
   * **协议里推不出来，只能各家自己说**。而且桥有路由不代表后端兑现：本机
   * zcode-acp-server 0.5.1 会转发 steer，ZCode 后端 0.16.3 仍回 `Method not found`；
   * Grok 已验证的首方扩展另走 `steerCall`。
   * 不填就是没有：给一个点了没反应的入口，比不给更糟。
   */
  compact?: boolean
  steer?: boolean
  /** 标准 `session/steer` 之外、由厂商公开的插话请求；存在即认领 steer 能力。 */
  steerCall?: ForeignSteer
  /** 标准 `session/fork` 之外、由厂商公开的完整分叉请求；存在即认领 fork 能力。 */
  fork?: ForeignFork
  /**
   * 认不认领 `terminal/*`（替 agent 起进程）。
   *
   * **只给真需要的那家开。** kimi 的 ACP 运行时没有本地兜底，不认领它一条命令都跑不了
   *（实测，见 `terminal.ts`）；而 codex-acp / grok / zcode 自己起进程，
   * 认领了反而是把命令从**它们自己的沙箱里拽出来**——那层沙箱正是判定错了之后的兜底。
   */
  terminal?: boolean
  /**
   * 这家用**私有通知**报「模型 / 强度换了」时，怎么把它认出来。
   *
   * 和 `contextUsed` 同一条路、同一个理由：协议里没有这件事，各家各报各的，
   * 驱动这一层不该认识任何一家的私有方法名。
   *
   * 实测 grok：在自己的 `_x.ai/session_notification` 里推
   * `{sessionUpdate:"model_changed", model_id, reasoning_effort}`——
   * **你在它自己的界面里改了强度，omni 靠这条才跟得上**。
   * 返回 undefined = 这条通知与模型无关。
   */
  modelChanged?: (method: string, params: unknown) => { model?: string; effort?: string } | undefined
}
