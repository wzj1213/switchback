import type { EngineId, ThreadId, TurnId } from "./ids.js"

/** 会话的信任档。语义与 `@omni/approval` 的 `Trust` 一致，此处只做承载。 */
export type Trust = "read-only" | "auto-edit" | "full"

export type ThreadStatus = "idle" | "running" | "waiting_approval" | "failed"

/** 一次对话。绑定一个工作区，同一时刻绑定一个引擎（可中途接力换掉）。 */
export interface Thread {
  id: ThreadId
  title: string
  /** 绝对路径。工作区边界的唯一真源，所有写范围判定都以它为准。 */
  cwd: string
  engine: EngineId
  trust: Trust
  status: ThreadStatus
  createdAt: number
  updatedAt: number
  /** 接力历史：曾经驱动过这个 thread 的引擎，按时间先后。 */
  engineHistory: readonly EngineId[]
  /**
   * 从磁盘回放出来、**背后没有活着的引擎进程**。
   *
   * 重启之后历史都还在，但引擎那边的对话记忆不在——直接往下发消息，
   * 模型会像没见过前面那些内容一样回答。所以这类会话是只读的，
   * 界面必须说清楚，不能让人对着一个能打字却答非所问的输入框发懵。
   */
  detached?: boolean
  meta?: Record<string, unknown>
}

export type TurnStatus = "running" | "completed" | "interrupted" | "failed"

/** 一轮。通常从一条用户消息开始，到引擎交还控制权为止。 */
export interface Turn {
  id: TurnId
  threadId: ThreadId
  /** 这一轮由哪个引擎执行——接力后同一 thread 的不同轮会不同。 */
  engine: EngineId
  status: TurnStatus
  startedAt: number
  endedAt?: number
  /** 失败原因，`status === "failed"` 时必填。 */
  error?: string
  meta?: Record<string, unknown>
}
