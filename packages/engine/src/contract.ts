import type {
  EngineId,
  Event,
  ItemId,
  ModelOption,
  RememberScope,
  ThreadId,
  TurnId,
  Trust,
} from "@omni/protocol"
import type { Rule } from "@omni/approval"
import type { Probe } from "./probe.js"

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
  /**
   * 判定器给出的完整建议规则。
   *
   * 只给 `rememberHint`（一句人话）是不够的：用户勾了「始终允许」之后，
   * 宿主要**把规则本身存下来**，光有描述存不了。
   */
  suggest?: Rule
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
  /**
   * 已生效的记忆规则（session 级与 project 级合并后）。
   *
   * **是取值函数不是数组**：用户在会话中途勾了「本对话不再问」，
   * 新规则必须对**接下来的**判定立刻生效。传一份快照进来的话，
   * 驱动会一直拿着开会话那一刻的旧清单。
   */
  memory: () => readonly Rule[]
  /** 事件出口。必须能消费得比引擎产出快——本层不做背压。 */
  emit: (event: Event) => void
  /** 判定为 escalate 时调用，等用户裁决 */
  askUser: (ask: ApprovalAsk) => Promise<ApprovalAnswer>
  /**
   * 引擎那边的会话句柄，用于续跑。传了就接着上次的对话，不传就是全新会话。
   * 格式由各家自己定，omni 原样存取。
   */
  resume?: string
  /**
   * 驱动拿到自己的会话句柄时回调。
   *
   * **必须是回调而不是返回值**：Claude 的 session id 是在
   * `system/init` 消息里到达的，比 `start()` 返回晚。
   */
  onHandle?: (handle: string) => void
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
  /** 这个引擎能选哪些模型。拿不到就给空数组，界面据此不显示选择器。 */
  models: () => Promise<readonly ModelOption[]>
  /** 换模型。`effort` 只有报了 `efforts` 的引擎会用。 */
  setModel: (model: string, effort?: string) => Promise<void>
  /** 幂等。返回时进程应已退出。 */
  dispose: () => Promise<void>
}

export interface EngineDriver {
  readonly id: EngineId
  start: (req: StartRequest) => Promise<EngineSession>
  /**
   * 这台机器上装了吗。
   *
   * **由驱动自己回答，不由宿主猜。** 每家的「装了」判据不一样：
   * codex 是 PATH 上有没有那个二进制；Claude 的 CLI 由 SDK 自己解析，
   * 不在 PATH 上也可能跑得起来。宿主统一 `which` 一遍的话，
   * 会把一个能用的引擎灰掉——那比不检查更糟。
   *
   * 不实现就是「不知道」，界面照常显示，不做任何标注。
   */
  probe?: () => Promise<Probe>
}
