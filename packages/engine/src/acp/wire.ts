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
 * | | 0.16.0（旧命名空间） | 1.3.0（新命名空间） |
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
  title?: string | null
  kind?: AcpToolKind | null
  status?: AcpToolStatus | null
  content?: readonly AcpDiff[] | null
  locations?: readonly AcpLocation[] | null
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
}

export interface AcpPlanEntry {
  content?: string
  status?: string
  priority?: string
}

export interface AcpUpdate {
  sessionUpdate?: string
  content?: AcpContent
  entries?: readonly AcpPlanEntry[]
  /** `usage_update`：已用 / 窗口大小。**不是累计账单**，正是 omni 要的那个数。 */
  used?: number
  size?: number
  currentModeId?: string
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
  }
  agentInfo?: { name?: string; title?: string; version?: string }
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
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"

export interface AcpPromptResult {
  stopReason?: AcpStopReason
}
