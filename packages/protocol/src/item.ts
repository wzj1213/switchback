import type { ItemId, TurnId } from "./ids.js"

export type ItemKind =
  | "user_message"
  | "agent_message"
  | "reasoning"
  | "tool_call"
  | "plan"
  | "approval"
  | "error"

interface ItemBase {
  id: ItemId
  turnId: TurnId
  kind: ItemKind
  at: number
  /** 厂商特有字段的出口，借 ACP `_meta` 约定。读之前自己判类型。 */
  meta?: Record<string, unknown>
}

export interface UserMessageItem extends ItemBase {
  kind: "user_message"
  text: string
  /** 附件的本地绝对路径。 */
  attachments?: readonly string[]
}

export interface AgentMessageItem extends ItemBase {
  kind: "agent_message"
  text: string
  /** 流式未结束时为 false；渲染层据此决定是否显示光标。 */
  complete: boolean
}

export interface ReasoningItem extends ItemBase {
  kind: "reasoning"
  text: string
  complete: boolean
}

/**
 * `interrupted` 是必需的一档，不是锦上添花。
 *
 * 轮次被中断时，在途的工具调用既没成功也没失败，更不是被拒——
 * 没有这一档就只能把它留在 `running`，于是界面上出现一条**永远转下去**的工具行。
 */
export type ToolStatus = "pending" | "running" | "ok" | "failed" | "denied" | "interrupted"

export type FileChangeKind = "add" | "delete" | "update"

/**
 * 一次改动里的**一个**文件。
 *
 * 复数是必须的：codex 的一次 `apply_patch` 可以同时改好几个文件，
 * 压成单个 path 加一坨拼接的 diff 之后，界面就再也没法按文件分组展示了。
 */
export interface FileChange {
  path: string
  kind: FileChangeKind
  /**
   * `update` 时是标准 unified diff；`add` / `delete` 时各家给的是**文件内容本身**
   * （没有 `+`/`-` 前缀）——渲染层必须按 `kind` 决定怎么读。
   */
  diff?: string
  added: number
  removed: number
}

/** 工具调用的渲染形态。五种覆盖各家 95% 的调用，其余落 `other`。 */
export type ToolDetail =
  | { kind: "shell"; command: string; cwd?: string; exitCode?: number; output?: string }
  /** `path` 是标题用的展示目标（多文件时取第一个）；逐文件明细在 `files`。 */
  | { kind: "file_edit"; path: string; files: readonly FileChange[]; added: number; removed: number }
  | { kind: "file_read"; path: string; range?: readonly [number, number] }
  | { kind: "fetch"; url: string }
  | { kind: "other"; name: string; input?: unknown; output?: unknown }

export interface ToolCallItem extends ItemBase {
  kind: "tool_call"
  /** 引擎侧的工具名原文，用于审批判定与问题排查。 */
  tool: string
  status: ToolStatus
  detail: ToolDetail
  /** `status === "failed"` 时的原因。 */
  error?: string
}

export interface PlanStep {
  text: string
  status: "pending" | "in_progress" | "done" | "dropped"
}

export interface PlanItem extends ItemBase {
  kind: "plan"
  steps: readonly PlanStep[]
}

export type ApprovalStatus = "pending" | "allowed" | "denied"

/** 只有判定结果为 escalate 的请求才会成为 item——自动放行的不进 transcript。 */
export interface ApprovalItem extends ItemBase {
  kind: "approval"
  /** 关联的工具调用；渲染层据此把审批卡挂在对应调用下方。 */
  toolCallId: ItemId
  tool: string
  summary: string
  status: ApprovalStatus
  /** 判定器给出的升级理由，写给人看。 */
  reason: string
  /** 可选的记忆建议，用户勾选后本会话/本项目不再问。 */
  rememberHint?: string
}

export interface ErrorItem extends ItemBase {
  kind: "error"
  message: string
  /** 可恢复的错误渲染成提示，不可恢复的渲染成终态。 */
  fatal: boolean
}

export type Item =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | ToolCallItem
  | PlanItem
  | ApprovalItem
  | ErrorItem
