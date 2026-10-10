import type { ItemId, TurnId } from "./ids.js"
import type { LaneRef } from "./lane.js"

export type ItemKind =
  | "user_message"
  | "agent_message"
  | "reasoning"
  | "tool_call"
  | "plan"
  | "approval"
  | "notice"
  | "error"

/** 引擎在空闲会话里按自己保存的计划主动触发的一轮。 */
export interface ScheduledMessageOrigin {
  kind: "scheduled"
  taskId: string
  /** 引擎原样上报的计划表达式，例如 Kimi 的五段 cron。 */
  schedule: string
  recurring: boolean
  /** 休眠期间错过的多次触发被引擎合并成这一轮时，大于 1。 */
  coalescedCount: number
  /** 引擎明确说明这是过期计划的最后一次执行。 */
  stale: boolean
}

/** 引擎原生终端入口执行的命令；不是模型工具调用，也不是普通聊天提示。 */
export interface ShellMessageOrigin {
  kind: "shell"
}

/** 引擎原生长期目标在一轮完成后自行开启的下一轮；没有一段冒充用户的提示正文。 */
export interface GoalContinuationOrigin {
  kind: "goal_continuation"
}

export type UserMessageOrigin =
  | "handoff"
  | ScheduledMessageOrigin
  | ShellMessageOrigin
  | GoalContinuationOrigin

interface ItemBase {
  id: ItemId
  /**
   * 引擎（驱动）报上来的原 id。宿主为了全局唯一把 `id` 重铸了（见 host 的 `item-scope.ts`），
   * 原来那个留在这里，只用来到那一家的原始记录里对位——换引擎交接的转写把它标在工具调用后面。
   * 宿主自己铸的条目（用户消息、审批卡等）和旧记录没有这个字段。
   */
  nativeId?: string
  turnId: TurnId
  kind: ItemKind
  at: number
  /** 从原生分叉或接管历史抄进来的记录；展示保留，但不算当前会话新发生的编辑。 */
  inherited?: true
  /**
   * 不属于主线时，属于哪条旁路。**缺席 = 主线**（见 `lane.ts` 的 `LaneRef`）。
   *
   * **`kind: "approval"` 与 `kind: "error"` 一律不打这个字段**，理由见
   * `protocol/README.md`「不拥有什么」：它们随分流走进侧栏之后，侧栏关着、
   * 或者用户正在看另一个标签时，一张**正在等他点**的审批卡就消失了。
   */
  lane?: LaneRef
}

export interface UserMessageItem extends ItemBase {
  kind: "user_message"
  text: string
  /** 附件的本地绝对路径。 */
  attachments?: readonly string[]
  /**
   * 缺席才表示人亲手发送；存在时必须换形态，不能靠右冒充“你说的”。
   * `handoff` 是换引擎后 Switchback 附在第一句话前的交接说明（用户开着「换引擎自动交接」时），
   * 界面原样显示它到底发了什么；旧日志里同名的条目也按它读。structured origin 来自引擎公开事件。
   */
  origin?: UserMessageOrigin
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
  | {
      kind: "shell"
      command: string
      cwd?: string
      exitCode?: number
      output?: string
      /** 引擎明确上报的后台终端活动；输入原文要留痕，空输入表示它正在轮询等待。 */
      terminal?: { waiting: boolean; inputs: readonly string[] }
    }
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
  /**
   * 引擎给这次计划更新写的一句话理由。**只有报了才有**——
   * 目前实测只有 codex 会带（`turn/plan/updated` 的 `explanation`），
   * ACP 那一路和 claude 的待办工具都没有这个概念。
   *
   * 各家能报的东西本来就不一样，Switchback 不替没报的那几家编一句。
   */
  explanation?: string
}

export type ApprovalStatus = "pending" | "allowed" | "denied" | "cancelled"

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
  /** 引擎报的发起方（子 agent、后台任务）。主 agent 自己要的权限没有这一项。 */
  origin?: ApprovalOrigin
}

/**
 * 一次权限请求是谁发起的。**只用引擎自己报的 id**（Claude 的 `agentID`、Kimi 的 `agentId`）：
 * 对得上旁路就能写出名字，对不上就照原样显示 id，不猜。引擎没报就整个缺席，界面写「来源未标明」。
 */
export interface ApprovalOrigin {
  kind: "subagent" | "task"
  id: string
  /** 给人看的名字；只有对得上旁路（lane）时才有。 */
  label?: string
}

/**
 * 主轮之外来的一次权限请求：后台子 agent、workflow 在主轮收工之后才来要权限。
 *
 * 不进转录区（没有轮次可挂），挂在会话上，输入框上方列出来等人点——和后台问题
 *（`Thread.pendingQuestions`）同一个位置。不设超时：引擎在等，界面写已经等了多久。
 * 落定用的仍是 `approval.resolve`，`id` 就是那条命令里的 `itemId`。
 */
export interface PendingApproval {
  id: ItemId
  tool: string
  summary: string
  reason: string
  rememberHint?: string
  /** 撞上红线的那种不能记成规则，卡上不给「记住」那几档。 */
  redline?: boolean
  origin?: ApprovalOrigin
  /** 开始等的时刻。 */
  at: number
}

export type NoticeLevel = "info" | "notice" | "suggestion" | "warning"

/** 引擎自己发给人的纯文本提示；不是模型回答，也不是 Switchback 推断出的状态。 */
export interface NoticeItem extends ItemBase {
  kind: "notice"
  message: string
  /** 原生消息自报的视觉级别。渲染层只据此调权重，不改写原文。 */
  level: NoticeLevel
}

export interface ErrorItem extends ItemBase {
  kind: "error"
  message: string
  /** 可恢复的错误渲染成提示，不可恢复的渲染成终态。 */
  fatal: boolean
  /**
   * 引擎自己给这条报错补的一句原因。**报了才有，Switchback 不替它编。**
   *
   * 重试类的报错尤其需要它：`message` 那句只说「还在试」（codex 实测发的是
   * `Reconnecting... 1/5`），为什么断了全在这一句里。
   */
  detail?: string
}

export type Item =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | ToolCallItem
  | PlanItem
  | ApprovalItem
  | NoticeItem
  | ErrorItem
