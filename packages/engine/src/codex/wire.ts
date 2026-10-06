/**
 * codex app-server 线上类型的**窄声明**。
 *
 * 权威定义可以自己生成，不要靠记忆：
 *
 * ```sh
 * codex app-server generate-ts --out /tmp/codex-proto
 * ```
 *
 * 生成出来是一整套随版本扩张的请求、应答与通知。这里只声明**我们真正读的字段**，
 * 理由和 `claude/translate.ts` 的 `RawBlock` 一样：直接依赖对方的完整联合，
 * 每次 codex 升级都会编译不过，而我们其实只关心其中一小撮。
 *
 * 全部字段按「可能不存在」声明——线上来的东西不受我们控制。
 */

export type { RequestId } from "../rpc.js"

export interface WireThread {
  id: string
}

export interface WireGoal {
  objective?: unknown
  status?: unknown
  tokenBudget?: unknown
  tokensUsed?: unknown
  timeUsedSeconds?: unknown
}

export interface WireGoalUpdated {
  threadId?: unknown
  turnId?: unknown
  goal?: WireGoal
}

export type WireTurnStatus = "inProgress" | "completed" | "interrupted" | "failed"

export interface WireTurn {
  id: string
  status?: WireTurnStatus
  error?: { message?: string } | null
}

/** codex 已经替我们解析过命令。`read` 能直出 `file_read`，省掉自己猜的功夫。 */
export interface WireCommandAction {
  type: string
  command?: string
  path?: string | null
  name?: string
}

export interface WireFileChangeEntry {
  path: string
  kind?: { type?: string }
  diff?: string
}

export type WireItemStatus = "inProgress" | "completed" | "failed" | "declined"

export interface WireItem {
  type: string
  id: string
  /** agentMessage */
  text?: string
  /** agentMessage：`commentary` 是过程旁白，`final_answer` 是最终答复 */
  phase?: string | null
  /** reasoning */
  summary?: readonly string[]
  content?: readonly string[]
  /** commandExecution */
  command?: string
  cwd?: string | null
  commandActions?: readonly WireCommandAction[] | null
  aggregatedOutput?: string | null
  exitCode?: number | null
  processId?: string | null
  source?: string
  /** 驱动从 terminalInteraction 通知并回在在途命令上的会话内状态，不是 app-server item 字段。 */
  terminalInputs?: readonly string[]
  waitingForTerminal?: boolean
  /** fileChange */
  changes?: readonly WireFileChangeEntry[]
  /** mcpToolCall */
  server?: string
  tool?: string
  arguments?: unknown
  result?: unknown
  /** MCP 进度通知由驱动挂回在途 item；不是 completed item 的原生字段。 */
  progress?: readonly string[]
  /** dynamicToolCall */
  namespace?: string | null
  contentItems?: readonly unknown[] | null
  success?: boolean | null
  /** collabAgentToolCall */
  receiverThreadIds?: readonly string[]
  prompt?: string | null
  model?: string | null
  reasoningEffort?: string | null
  error?: { message?: string } | null
  /** webSearch */
  query?: string
  /** commandExecution / fileChange / mcpToolCall 共用 */
  status?: WireItemStatus | string
}

export interface WireItemLifecycle {
  item: WireItem
  threadId: string
  turnId: string
}

export interface WireDelta {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

export interface WireFilePatch {
  threadId: string
  turnId: string
  itemId: string
  changes?: readonly WireFileChangeEntry[]
}

export interface WireMcpProgress {
  threadId: string
  turnId: string
  itemId: string
  message?: string
}

/** 统一终端写入成功后的原生通知；空 stdin 表示仍在轮询活着的后台进程。 */
export interface WireTerminalInteraction {
  threadId: string
  turnId: string
  itemId: string
  processId: string
  stdin: string
}

export interface WireReasoningPart {
  threadId: string
  turnId: string
  itemId: string
  summaryIndex: number
}

export interface WireModelVerification {
  verifications?: readonly string[]
}

export interface WireSafetyBuffering {
  showBufferingUi?: boolean
  fasterModel?: string | null
}

export interface WireModelRerouted {
  threadId?: string
  turnId?: string
  fromModel?: string
  toModel?: string
  reason?: string
}

export interface WireStrictReview {
  startedAtMs?: number
}

export interface WireTurnLifecycle {
  threadId: string
  turn: WireTurn
}

export interface WireHookEntry {
  kind?: "warning" | "stop" | "feedback" | "context" | "error" | string
  text?: string
}

/** `hook/started` / `hook/completed` 共用；窄声明只留 Switchback 展示与收口需要的字段。 */
export interface WireHookRun {
  id?: string
  eventName?: string
  handlerType?: string
  executionMode?: string
  scope?: string
  sourcePath?: string
  source?: string
  status?: "running" | "completed" | "failed" | "blocked" | "stopped" | string
  statusMessage?: string | null
  entries?: readonly WireHookEntry[]
}

export interface WireHookLifecycle {
  threadId?: string
  turnId?: string | null
  run: WireHookRun
}

export interface WireTokenUsage {
  threadId?: string
  tokenUsage?: {
    /** 最近一次请求：input + output 就是这次占了多少上下文 */
    last?: { totalTokens?: number }
    /** 本会话累计 */
    total?: { totalTokens?: number }
    modelContextWindow?: number
  }
}

export interface WireError {
  error?: {
    message?: string
    /**
     * 引擎给这条报错补的**原因**。
     *
     * 重试期间 `message` 只是一句「Reconnecting... 1/5」——它说的是「还在试」，
     * 一个字都没说为什么。真正的原因（实测 `We're currently experiencing high demand…`、
     * `stream disconnected before completion: …`）在这个字段里，
     * codex 自己的界面也是这么摆的：抬头是第几次重连，底下是这一句。
     */
    additionalDetails?: string | null
  }
  willRetry?: boolean
  threadId?: string
  turnId?: string
}

/** `warning` / `guardianWarning` / `configWarning` 共用的窄联合。 */
export interface WireWarning {
  message?: string
  summary?: string
  details?: string | null
  path?: string
  range?: { start?: { line?: number; column?: number } }
}

/**
 * 审批请求。**注意这里没有命令、没有 diff**——只有一个 `itemId`。
 * 要说清楚「在批准什么」，必须去查此前 `item/started` 记下的那条 item。
 * 见 `driver.ts` 的 `inflight`。
 */
export interface WireApprovalRequest {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
  /** 命令审批才有；文件审批的这些字段一律缺席 */
  command?: string | null
  cwd?: string | null
  networkApprovalContext?: { host?: string; protocol?: string } | null
  /** 文件审批：请求把这个根目录加进可写范围 */
  grantRoot?: string | null
}

/** 命令审批与文件审批的决定枚举不同，但我们只用两端的这几个值。 */
export type WireDecision = "accept" | "acceptForSession" | "decline"

/**
 * MCP server 主动向客户端发起的表单请求。
 *
 * Computer Use 的「允许使用这个应用吗」走的不是上面的 requestApproval，
 * 而是 `mcpServer/elicitation/request`。这里只接它用到的窄字段；完整形状仍以
 * `codex app-server generate-ts` 生成的协议为准。
 */
export interface WireElicitationMeta {
  codex_approval_kind?: string
  connector_id?: string
  connector_name?: string
  persist?: readonly unknown[]
  riskLevel?: string
  subtitle?: string
  tool_call_id?: string
  tool_name?: string
  tool_params_display?: readonly {
    name?: string
    display_name?: string
    value?: unknown
  }[]
}

export interface WireMcpElicitation {
  threadId?: string
  turnId?: string | null
  serverName?: string
  mode?: string
  _meta?: WireElicitationMeta | null
  message?: string
  requestedSchema?: unknown
}

export interface WireMcpElicitationResponse {
  action: "accept" | "decline" | "cancel"
  content: Record<string, unknown> | null
  _meta: { persist: "session" | "always" } | null
}

export type WireSandbox = "read-only" | "workspace-write" | "danger-full-access"

/** app-server 接受的三种传统审批策略；自动评审是旁边独立的 reviewer 旋钮。 */
export type WireApprovalPolicy = "untrusted" | "on-request" | "never"

/** `auto_review` 就是 Codex 权限菜单里的 “Approve for me”。 */
export type WireApprovalsReviewer = "user" | "auto_review"

/**
 * `skills/list` 回来的一条技能。
 *
 * `interface` 是给界面用的那一份（displayName 常常是中文，比 `name` 好读），
 * 缺席就退回 `name`/`description`——**不是所有技能都写了那一段**。
 */
export interface WireSkill {
  name: string
  description?: string
  enabled?: boolean
  /** 你自己装的还是引擎自带的。实测取值 `user` / `system`。 */
  scope?: string
  interface?: {
    displayName?: string | null
    shortDescription?: string | null
  }
}

export interface WireSkillGroup {
  cwd?: string
  skills?: readonly WireSkill[]
}

/**
 * `account/rateLimits/updated` 推上来的形状。
 *
 * 字段名以 codex app-server 协议为准：`primary` / `secondary` 各带
 * `usedPercent`、`windowDurationMins`。
 * 两个都可能是 `null`（额度不受限的账号）。
 */
export interface WireRateWindow {
  usedPercent?: number
  windowDurationMins?: number
  /**
   * 什么时候重置。**实测是 Unix 秒（数字），不是 ISO 字符串。**
   *
   * 第一版按字符串写，于是 `typeof === "string"` 那道过滤把它**全部丢掉**了——
   * 一声不响，界面上永远没有「什么时候恢复」。而额度打满时，
   * 那恰恰是唯一有行动意义的信息。用例里当时填的也是自己编的 ISO 串，
   * 所以测试是绿的。**形状不能靠想，要探。**
   */
  resetsAt?: string | number
}

export interface WireRateLimits {
  primary?: WireRateWindow | null
  secondary?: WireRateWindow | null
}

/**
 * `mcpServer/startupStatus/updated` 推上来的形状。
 *
 * 0.149.0 生成协议明确列出 starting / ready / failed / cancelled；仍保留 string
 * 是为了升级后未知失败态继续 fail-closed，而不是让能力静默消失。
 */
export interface WireMcpStatus {
  threadId?: string
  name?: string
  status?: string
  error?: unknown
  failureReason?: unknown
}

/**
 * `turn/plan/updated` 推上来的形状。**每次都是整份快照**，不是增量——
 * 所以翻译端直接整份替换，不用维护「第几条改了」。
 *
 * ## status 的大小写有两份，别拿错
 *
 * 同一个枚举在 codex 仓库里序列化了两遍：
 *
 * - `codex-rs/protocol/src/plan_tool.rs` 的 `StepStatus` 是 **snake_case**（`in_progress`）
 * - `codex-rs/app-server-protocol/.../v2/turn.rs` 的 `TurnPlanStepStatus` 是
 *   **camelCase**（`inProgress`）——`#[serde(rename_all = "camelCase")]`
 *
 * 线上这条走的是 **v2 那份**，所以是 `inProgress`。这正是之前 `SandboxPolicy`
 * 咬过一次的同一个坑（同名类型在一个仓库里存在多份）。两种都认是因为**证据摆着**
 * 有两份序列化，不是因为猜——猜的话就该只写实测到的那一种。
 */
export interface WirePlanUpdate {
  threadId?: string
  turnId?: string
  explanation?: string | null
  plan?: readonly { step?: string; status?: string }[]
}
