/**
 * ACP（Agent Client Protocol）线上类型的**窄声明**。
 *
 * 权威定义不要靠记忆，自己取：
 *
 * ```sh
 * npm pack @agentclientprotocol/sdk        # schema/schema.json + dist/schema.d.ts
 * ```
 *
 * 这里只声明**我们真正读的字段**，理由和 `codex/wire.ts` 一样：直接依赖对方
 * 完整的 zod schema，对方每加一个可选字段我们就要跟一次版本。
 *
 * ## 版本这件事必须先说清楚
 *
 * 官方包换过一次命名空间（`@zed-industries/*` → `@agentclientprotocol/*`），
 * 两代 SDK 的 `PROTOCOL_VERSION` **都是 1**，新版只是多了些可选方法与更新类型。
 * 实测同一个 codex 适配器的两个版本：
 *
 * | | 0.16.0（旧命名空间） | 1.4.0（新命名空间） |
 * | --- | --- | --- |
 * | `session/new` 报模型 | `configOptions[id="model"]` | `models.availableModels` |
 * | `session/new` 报档位 | 无 | `modes` **和** `configOptions[id="mode"]` |
 *
 * 所以两条路都要认。只认新的，用户装了旧适配器就一个模型都选不出来；
 * 只认旧的，新适配器同理。这不是防御性编程，是实测出来的两种真实形状。
 */

export interface AcpContent {
  type?: string
  text?: string
  /** `resource_link` 用 */
  uri?: string
  name?: string
}

export interface AcpDiff {
  type?: string
  path?: string
  oldText?: string | null
  newText?: string
  /** `type: "terminal"` 时才有 */
  terminalId?: string
  content?: AcpContent
}

export interface AcpLocation {
  path?: string
  line?: number | null
}

export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed"

/** `read` / `edit` / `execute` / `fetch` / `think` / `search` / `delete` / `move` / `switch_mode` / `other` */
export type AcpToolKind = string

/**
 * `tool_call` 与 `tool_call_update` 共用一个形状。
 *
 * **区别只在于哪些字段必填**：`tool_call` 一定带 `title`，`tool_call_update`
 * 只保证带 `toolCallId`，其余字段「给了就替换，没给就保持原样」。
 * 所以驱动里存的是**合并后的**状态，不是最后一条更新——见 `update.ts` 的 `merge`。
 */
export interface AcpToolCall {
  toolCallId?: string
  /** `tool_call` 的标题，或 `session_info_update` 的原生会话标题。 */
  title?: string | null
  /** `session_info_update` 的 agent 时间；宿主不用外部时钟覆盖本机事件顺序。 */
  updatedAt?: string | null
  kind?: AcpToolKind | null
  status?: AcpToolStatus | null
  content?: readonly AcpDiff[] | null
  locations?: readonly AcpLocation[] | null
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
  /** Grok 等 agent 的规范化原生工具身份；未知扩展保持不透明。 */
  _meta?: Readonly<Record<string, unknown>>
}

export interface AcpPlanEntry {
  content?: string
  status?: string
  priority?: string
}

/**
 * `available_commands_update` 里的一条（ACP 的 `AvailableCommand`）。
 *
 * **各家往里塞的东西不一样**：grok 报的是内建命令（`compact`、`context`、
 * `deep-research`…），kimi 把自己认到的 skill 也一并报在这里。
 * 对用户是同一件事——打个 `/` 能选的东西，所以不分家。
 */
export interface AcpCommand {
  name?: string
  description?: string | null
  /** 参数提示。ACP 把它包了一层：`{ hint }`；没有参数的命令报 null。 */
  input?: { hint?: string | null } | null
}

export interface AcpUpdate {
  sessionUpdate?: string
  content?: AcpContent
  /** 新版 ACP 文本块的原生身份；旧 agent 不带，二者都要兼容。 */
  messageId?: string | null
  entries?: readonly AcpPlanEntry[]
  /** `available_commands_update`：引擎自己认的斜杠命令。 */
  availableCommands?: readonly AcpCommand[]
  /** `usage_update`：已用 / 窗口大小。**不是累计账单**，正是 omni 要的那个数。 */
  used?: number
  size?: number
  currentModeId?: string
  /**
   * `config_option_update`：agent 那边的可选项变了。
   *
   * **换模型之后强度的词表会变**：实测 ZCode 的 GLM-5.3 有 low/high/max，
   * 换到 GLM-5-Turbo 之后一个都没有（照旧发过去，引擎直接报错）。
   */
  configOptions?: readonly AcpConfigOption[]
  // tool_call / tool_call_update 的字段直接摊平在这一层
  toolCallId?: string
  title?: string | null
  kind?: AcpToolKind | null
  status?: AcpToolStatus | null
  locations?: readonly AcpLocation[] | null
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
}

export interface AcpNotification {
  sessionId?: string
  update?: AcpUpdate
}

export type AcpPermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

export interface AcpPermissionOption {
  optionId?: string
  name?: string
  kind?: AcpPermissionKind | string
}

export interface AcpPermissionRequest {
  sessionId?: string
  toolCall?: AcpToolCall
  options?: readonly AcpPermissionOption[]
}

export interface AcpMode {
  id?: string
  name?: string
  description?: string | null
}

export interface AcpModel {
  modelId?: string
  name?: string
  description?: string | null
  /**
   * 协议的扩展位。**上下文窗口大小就藏在这儿**——ACP 没有为它定字段，
   * 而实测 grok 每个模型都报 `_meta.totalContextTokens`（grok 4.6 = 500000）。
   * 拿不到就没有分母，界面上只显示占用数字、不画比例条。
   */
  /**
   * 扩展位。**omni 只读它认得的那几个键**，其余原样不管。
   *
   * `totalContextTokens`：窗口大小（实测 grok 4.6 = 500000）。
   * `reasoningEffort*`：有的 agent 把强度放在这儿而不是 `configOptions`——
   * 实测 grok 就是（见 `setup.ts` 的 `withMetaEfforts`）。
   */
  _meta?: {
    totalContextTokens?: number
    supportsReasoningEffort?: boolean
    reasoningEffort?: string
    reasoningEfforts?: readonly { id?: string; value?: string; label?: string }[]
  } | null
}

export interface AcpConfigOption {
  id?: string
  /**
   * 这一项在语义上是什么（`model` / `thought_level` / `mode`）。
   * **认它优先于认 `id`**：id 是各家自己起的名字，category 才是约定的语义位。
   */
  category?: string
  currentValue?: unknown
  options?: readonly { value?: unknown; name?: string; description?: string | null }[]
}

export interface AcpNewSession {
  sessionId?: string
  modes?: { availableModes?: readonly AcpMode[]; currentModeId?: string } | null
  models?: { availableModels?: readonly AcpModel[]; currentModelId?: string } | null
  configOptions?: readonly AcpConfigOption[]
}

export interface AcpInitialize {
  protocolVersion?: number
  agentCapabilities?: {
    loadSession?: boolean
    /** 提示词里能塞什么。实测 kimi 报 `{image:true, audio:false, embeddedContext:true}`。 */
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean }
    /**
     * 会话层面能做什么。**存在即支持**——ACP 用空对象当标记，
     * 实测 kimi 报 `{list:{}, resume:{}, close:{}, delete:{}, fork:{}}`。
     * 所以判据是「这个键在不在」，不是「它的值是不是 true」。
     */
    sessionCapabilities?: Record<string, unknown>
    /** 登录相关。`logout: {}` 表示认 `logout`（存在即支持，同 `sessionCapabilities`）。 */
    auth?: { logout?: unknown } | null
  }
  agentInfo?: { name?: string; title?: string; version?: string }
  /**
   * 它认的登录方式。**形状由 `auth.ts` 逐条认**——协议要求跳过认不出的项，
   * 而实测各家混着两代写法（`type: "terminal"` 与旧的 `_meta["terminal-auth"]`）。
   */
  authMethods?: readonly unknown[]
}

/** `session/list` 回来的一条。实测 kimi 的字段就这四个。 */
export interface AcpSessionRow {
  sessionId?: string
  cwd?: string
  title?: string | null
  /** ISO 字符串。 */
  updatedAt?: string
}

export type AcpStopReason =
  "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"

export interface AcpPromptResult {
  stopReason?: AcpStopReason
}
