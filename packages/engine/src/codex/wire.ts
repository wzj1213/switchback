/**
 * codex app-server 线上类型的**窄声明**。
 *
 * 权威定义可以自己生成，不要靠记忆：
 *
 * ```sh
 * codex app-server generate-ts --out /tmp/codex-proto
 * ```
 *
 * 生成出来是 90+ 个文件、74 种通知。这里只声明**我们真正读的字段**，
 * 理由和 `claude/translate.ts` 的 `RawBlock` 一样：直接依赖对方的完整联合，
 * 每次 codex 升级都会编译不过，而我们其实只关心其中一小撮。
 *
 * 全部字段按「可能不存在」声明——线上来的东西不受我们控制。
 */

export type { RequestId } from "../rpc.js"

export interface WireThread {
  id: string
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
  /** fileChange */
  changes?: readonly WireFileChangeEntry[]
  /** mcpToolCall */
  server?: string
  tool?: string
  arguments?: unknown
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

export interface WireTurnLifecycle {
  threadId: string
  turn: WireTurn
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
  error?: { message?: string }
  willRetry?: boolean
  threadId?: string
  turnId?: string
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
  /** 文件审批：请求把这个根目录加进可写范围 */
  grantRoot?: string | null
}

/** 命令审批与文件审批的决定枚举不同，但我们只用两端的这几个值。 */
export type WireDecision = "accept" | "acceptForSession" | "decline"

export type WireSandbox = "read-only" | "workspace-write" | "danger-full-access"

/** `untrusted` 把最多的请求路由给客户端；见 driver.ts 的 POLICY 注释。 */
export type WireApprovalPolicy = "untrusted" | "on-request" | "never"

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
 * 实测只见过 `status: "starting" | "ready"`（这台机器 5 个服务器全起来了），
 * 失败态的字面量**没有观察到**，所以判据写成「不是这两个就算失败」——
 * 见 `notify.ts` 的 `onMcpStatus`。
 */
export interface WireMcpStatus {
  threadId?: string
  name?: string
  status?: string
  error?: unknown
  failureReason?: unknown
}
