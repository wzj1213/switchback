import type { EngineId, Event, ItemId, RememberScope, ThreadId, TurnId, Trust } from "@omni/protocol"
import type { Rule } from "@omni/approval"

/** 需要人工裁决时递给宿主的东西。文本字段可能来自引擎，渲染前必须转义。 */
export interface ApprovalAsk {
  /** 关联的工具调用 item id */
  toolCallId: ItemId
  tool: string
  /** 优先用引擎给的人话标题；没有才回落到 tool + 参数 */
  summary: string
  /** 判定器给出的升级理由 */
  reason: string
  /** 可记忆成什么，用作「允许此对话」那一项的标签。没有就用默认文案。 */
  rememberHint?: string
}

export interface ApprovalAnswer {
  allow: boolean
  /**
   * 记住到什么范围。
   *
   * 以前这里是个 boolean，界面上表现为一个「本项目不再询问」的勾选框——
   * 但 boolean 表达不了 codex 那套 accept / acceptForSession 的区分，
   * 也表达不了「这次放行」和「这轮对话都放行」的差别，于是三种意图被压成两种。
   * 现在与 `Command.remember` 同型，各家驱动自己决定怎么落到原生语义上。
   */
  remember: RememberScope
}

export interface StartRequest {
  threadId: ThreadId
  /** 工作区绝对路径 */
  cwd: string
  trust: Trust
  /** 用户 home 绝对路径。approval 是纯函数，不读环境，所以由这里传。 */
  home: string
  /** 已生效的记忆规则（session 级与 project 级合并后） */
  memory: readonly Rule[]
  /** 事件出口。必须能消费得比引擎产出快——本层不做背压。 */
  emit: (event: Event) => void
  /** 判定为 escalate 时调用，等用户裁决 */
  askUser: (ask: ApprovalAsk) => Promise<ApprovalAnswer>
}

export interface EngineSession {
  readonly threadId: ThreadId
  /**
   * `turnId` 由**宿主**铸造并传入——prompt 是宿主发出的，所以它知道一轮什么时候开始。
   * 引擎只负责给自己产出的 item 铸 id，以及在收工时发 `turn.completed`
   * （只有引擎知道自己什么时候真的停下）。
   */
  prompt: (text: string, turnId: TurnId) => Promise<void>
  interrupt: () => Promise<void>
  setTrust: (trust: Trust) => Promise<void>
  /** 幂等。返回时进程应已退出。 */
  dispose: () => Promise<void>
}

export interface EngineDriver {
  readonly id: EngineId
  start: (req: StartRequest) => Promise<EngineSession>
}
