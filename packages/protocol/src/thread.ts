import type { EngineId, ThreadId, TurnId } from "./ids.js"

/** 会话的信任档。语义与 `@omni/approval` 的 `Trust` 一致，此处只做承载。 */
export type Trust = "read-only" | "auto-edit" | "full"

/**
 * `starting` 是必需的一档，不是锦上添花。
 *
 * 开一个会话要起引擎子进程、走协议握手——实测 codex 是 400ms，但**它不是零**，
 * 而在这之前界面上必须已经有这一行了。没有这一档的话只有两种做法：
 * 要么等引擎起完再显示（用户点下去几百毫秒没有任何反应，于是再点一下，
 * 于是真的建出两个会话——这是实测复现过的），要么显示成 `idle`
 * （那就是撒谎：输入框看起来能用，打进去的字会丢）。
 */
export type ThreadStatus = "starting" | "idle" | "running" | "waiting_approval" | "failed"

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
  /**
   * 引擎自己的会话句柄，用于续跑。
   *
   * 各家格式不同（codex 是它自己的 thread id，Claude 是 SDK 的 session id），
   * **omni 只负责原样存取，不解释它**。没有句柄的会话恢复出来只能读。
   */
  engineHandle?: string
  /** 当前模型的引擎侧 id。没设过就是引擎自己的默认，界面显示为「默认」。 */
  model?: string
  /** 推理强度。只有报了 `efforts` 的引擎才有意义。 */
  effort?: string
  /**
   * 分叉自哪个会话。
   *
   * **分叉的全部意义在于事后能比**——同一个目标交给两家跑，看谁做得对。
   * 不记这一条，两个会话在侧栏里就只是碰巧标题相似的两行，
   * 谁也说不清它们本来是一件事。对比视图（`Compare.tsx`）认这个字段。
   */
  forkedFrom?: ThreadId
  meta?: Record<string, unknown>
  /**
   * 用户**亲自起过名**。
   *
   * `title` 一直有值（新建时取目录名），所以光看 `title` 分不出「这是自动填的」
   * 还是「人特意起的」。而侧栏的行标题默认显示第一句提问——那通常比目录名有用——
   * 于是不区分的话，改完名什么都不会变，因为 preview 永远赢。
   */
  named?: boolean
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

/**
 * 一条斜杠命令。
 *
 * 两个来源，**界面上要分得出**：
 *
 * - `engine`：引擎自己报的。Claude 走 SDK 的 `supportedCommands()`
 *   （实测这台机器上 52 条，技能和内置命令都在里面）；
 *   codex 走 app-server 的 `skills/list`。**不硬编码任何一家的命令表**——
 *   用户装了什么技能只有引擎知道，写死的表第二天就过期。
 * - `omni`：omni 自己能做的事（新建、分叉、接力、导出…）。它们**不发给引擎**，
 *   点了就在本地执行。
 */
export interface SlashCommand {
  /** 不带前导斜杠。**这是要打进输入框的东西**，不是给人读的。 */
  name: string
  /**
   * 给人读的名字（「新建会话」）。
   *
   * codex 的面板左边一列全是人话（初始化、使用情况和计费、推理…），
   * 而不是 `/init`、`/usage`。人扫这一列是在**找那件事**，不是在认标识符。
   * 引擎报上来的命令没有这一份（`/code-review` 就叫 `/code-review`），
   * 那时候退回 `name`。
   */
  label?: string
  description: string
  /** 参数提示，如 `<file>` 或 `[<pr#>]`。没有参数就缺席。 */
  argumentHint?: string
  source: "engine" | "omni"
}
