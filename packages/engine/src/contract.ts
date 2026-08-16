import type { EngineCapabilities, EngineId, Event, ItemId, ModelOption, RememberScope, SlashCommand, ThreadId, Trust, TurnId } from "@omni/protocol"
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
   * 以**分叉**的方式开场：不是新起一条，也不是续上一条，而是复制一条已有的。
   *
   * ## 为什么在这儿，而不是老会话上的一个方法
   *
   * 第一版做成了 `EngineSession.fork()`：老会话复制一份，把新句柄交给新会话去续。
   * 真机上直接失败——`thread ... already has an active writer`。
   * **分出来的那条归创建它的那个进程管**，而 omni 每个会话一个引擎进程，
   * 于是新进程去续一条老进程还攥着的会话，拿不到写锁。
   * 实测 `thread/unsubscribe` 也不放锁。
   *
   * 让新进程自己去 fork 就成了（实测通过，而且分出来之后它能直接开轮次）。
   * 所以这件事属于「**这条会话怎么开场**」，和 `resume` 并列。
   *
   * **分不了就抛**，别默默起一条空的：调用方要靠这个失败退回交接包，
   * 而一条「看起来分叉了、其实什么都不记得」的会话是最坏的结果。
   */
  forkOf?: { handle: string; dropTurns?: number }
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
  /**
   * @param attachments 本地文件的绝对路径。各家怎么送由驱动决定
   *   （codex 走 `localImage` 直接给路径，Claude 要读成 base64 内容块）——
   *   **上面各层只管路径，不碰编码**。不支持的引擎（`capabilities().attachments`
   *   为 false）忽略这个参数即可。
   */
  prompt: (text: string, turnId: TurnId, attachments?: readonly string[]) => Promise<void>
  /**
   * 把一句话递进**正在跑的那一轮**：不开新轮次，也不打断它。
   *
   * **不支持就别实现**（`capabilities().steer` 报 false），宿主会退回排队。
   *
   * 实现方要自己守住「递进去的是不是同一轮」：codex 的 `turn/steer` 收一个
   * `expectedTurnId`，对不上就拒绝——那道护栏必须传下去。
   * 「用户按下回车」和「RPC 到达引擎」之间那一轮刚好收工，是个真实存在的窗口；
   * 不校验的话这句话会被塞进**下一轮**，而用户以为它改的是上一轮。
   */
  steer?: (text: string, attachments?: readonly string[]) => Promise<void>
  /**
   * 把标题告诉引擎。**不支持就别实现**，omni 侧照常改名。
   *
   * 为什么值得传：引擎自己也存着一份会话列表（codex 的 `thread/list`），
   * 你在 omni 里把会话改成「修分页那个」，在 codex 自己的界面里
   * 它还叫第一句提问的前二十个字。**同一条会话在两处叫不同名字**，
   * 而你要靠名字找到它。
   */
  setTitle?: (title: string) => Promise<void>
  /**
   * 用户删掉了这条会话——引擎那边也收拾一下。
   *
   * **归档不是删除**：codex 的 `thread/archive` 是可逆的，而删除不是。
   * omni 这边删的是自己的记录，没有理由替用户把引擎那边的原始记录也毁掉；
   * 但完全不管的话，你在 omni 里删了十条，codex 自己的列表里那十条还在。
   *
   * 在 `dispose()` **之前**调用——进程都没了就发不出去了。
   */
  discard?: () => Promise<void>
  interrupt: () => Promise<void>
  setTrust: (trust: Trust) => Promise<void>
  /** 这个引擎能选哪些模型。拿不到就给空数组，界面据此不显示选择器。 */
  models: () => Promise<readonly ModelOption[]>
  /** 换模型。`effort` 只有报了 `efforts` 的引擎会用。 */
  setModel: (model: string, effort?: string) => Promise<void>
  /**
   * 这个引擎认哪些斜杠命令。**拿不到就给空数组**——界面据此少画一段，不报错。
   *
   * 各家名字不一样（Claude 叫 command/skill，codex 叫 skill），
   * 但对用户是同一件事：打个 `/` 能选的东西。翻译成同一个形状在驱动里做，
   * 上面各层只认 `SlashCommand`。
   */
  commands?: () => Promise<readonly SlashCommand[]>
  /**
   * 压缩上下文。**不支持就别实现**——界面据此决定给不给这个入口。
   *
   * Claude 不实现：它自己的 `/compact` 已经在斜杠命令列表里了，
   * 再加一条 omni 的就是同一件事出现两次。codex 那边 app-server 有
   * `thread/compact/start`，但它不在 `skills/list` 里，所以必须由这里补。
   */
  compact?: () => Promise<void>
  /**
   * 这家引擎能做什么。**握手完成后由宿主问一次**，挂到会话上给界面用。
   *
   * 不做成可选：新增一种能力时，编译器会逼每个驱动表态——
   * 一家引擎支不支持某件事，只能由它自己回答，不该让界面去猜。
   */
  capabilities: () => EngineCapabilities
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
