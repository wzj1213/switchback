import type {
  EngineAccount,
  EngineAxis,
  EngineCapabilities,
  EngineGoal,
  EngineId,
  EngineThread,
  Event,
  Item,
  ItemId,
  ModelOption,
  RememberScope,
  QuestionPrompt,
  QuestionResponse,
  SlashCommand,
  ThreadId,
  Trust,
  TrustApply,
  TurnId,
  UserMessageOrigin,
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
  /**
   * 撞上的是哪条红线（没撞就缺席）。
   *
   * 宿主要用它挡住「本轮全部放行」：红线是那 8 条**最不该被一次点击盖掉**的，
   * 所以armed 之后它们照旧一条条问。不带这个字段的话，宿主分不出
   * 「档位升级上来的普通请求」和「凭据读取」，只能一刀切——
   * 要么这个功能挡不住红线，要么它几乎什么都放不过去。
   */
  redline?: string
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

/** 引擎等人的原生请求如何收口；取消时宿主不再留死卡。 */
export interface InteractionWait {
  signal?: AbortSignal
  timeoutMs?: number
}

/** 引擎在空闲时自行开启、但仍要纳入宿主主线状态机的一轮。 */
export interface NativeTurnStart {
  at: number
  /** 展示给人的原始可见输入；公开来源明确没有正文时为空，不得换成引擎内部提示。 */
  prompt: string
  /** 没有结构化来源就是同一引擎另一原生客户端发出的普通用户提示。 */
  origin?: UserMessageOrigin
}

/** 引擎的原生权限若只能在开场设置，宿主据此续接同一条会话后重启进程。 */
export type TrustChange =
  | { restart: false }
  | {
      restart: true
      /** 无法立刻重启（例如仍在跑）时给人的原因与下一步。 */
      detail: string
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
  askUser: (ask: ApprovalAsk, wait?: InteractionWait) => Promise<ApprovalAnswer>
  /** 引擎原生提出结构化问题时调用；回答原样回到该引擎，不转成普通提示词。 */
  askQuestion: (
    questions: readonly QuestionPrompt[],
    wait?: InteractionWait,
  ) => Promise<QuestionResponse>
  /**
   * 引擎通过公开协议报告自己已经开启一轮时，请宿主铸造 turn id 并同步建立主线。
   *
   * 目前的使用者是 Kimi 原生 cron、同会话其他客户端，以及断线时直接撞上的目标续轮。
   * cron 先发 `turn.started`，随后才在 `cron.fired` 给出供人阅读的原任务；驱动拿到这里返回的 id 后，
   * 才把后续正文与工具挂上去。
   * 宿主正在跑别的轮、会话已换代或关闭时返回 undefined，驱动不得覆盖现有轮次。
   */
  onNativeTurn?: (turn: NativeTurnStart) => TurnId | undefined
  /**
   * 引擎那边的会话句柄，用于续跑。传了就接着上次的对话，不传就是全新会话。
   * 格式由各家自己定，omni 原样存取。
   */
  resume?: string
  /**
   * 引擎自己的具名组装（例如 DSH profile）。
   *
   * 宿主只负责原样保存、续跑时原样传回；怎么解释由驱动决定。没有这一项时，
   * 驱动可以采用自己当前的默认组装。它和 `resume` 分开，是为了让原生句柄仍然
   * 保持原样可复制，不把 omni 的路由元数据编码进别人的 id。
   */
  profile?: string
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
   * **分不了就抛**，别默默起一条空的：调用方必须区分「原生复制失败」；
   * 尤其“从这里重来”不能拿空白会话冒充成功。
   */
  forkOf?: { handle: string; dropTurns?: number }
  /**
   * 驱动拿到自己的会话句柄时回调。
   *
   * **必须是回调而不是返回值**：Claude 的 session id 是在
   * `system/init` 消息里到达的，比 `start()` 返回晚。
   */
  onHandle?: (handle: string) => void
  /** 引擎自己生成或更新的会话标题；宿主会保护用户亲自起过的名字。 */
  onTitle?: (title: string) => void
  /**
   * 引擎**自己**换了模型或推理强度时回调。
   *
   * ## 为什么非要有这条路
   *
   * 换模型有两个发起方。用户点下拉走 `setModel`，宿主自己就知道结果；
   * 而 **agent 也会自己换**（ACP 的 `config_option_update`——实测换完模型之后
   * 强度的词表也跟着变）。第二种以前只走到 `models.updated`，而那条事件换的是
   * **清单**，不是**选中项**：清单更新了，`Thread.model` 还是旧值，
   * 界面照着 `Thread.model` 画，于是面板上写着一个引擎已经不在跑的模型。
   * 没有任何地方报错——和 `fromConfigOption` 注释里说的是同一个「安静的谎」。
   *
   * 形状照抄 `onHandle`，理由也一样：**驱动手上只有 `emit`，碰不到 `Thread`。**
   *
   * 每一项 `undefined` 都表示「这一项引擎没报」，宿主据此**不动**原值。
   * 「没报」和「报了个空」必须分开：后者会把用户选过的档悄悄清掉。
   */
  onModel?: (model: string | undefined, effort: string | undefined) => void
  /**
   * 驱动发现**引擎自己当前处于什么状态**时回调。
   *
   * 传部分字段，宿主做合并——引擎往往一次只报一样。
   * 和 `onHandle` / `onModel` 同一条路（走 `thread.updated` 落盘），
   * 理由也一样：驱动手上只有 `emit`，碰不到 `Thread`。
   *
   * **`match` 由驱动判，不由界面反推。** 反推做不到：档位匹配是 Trust → modeId 的
   * 打分，有损、多对一，反过来是一对多。而驱动知道自己发过什么、引擎回了什么。
   */
  onEngineState?: (patch: { axes?: readonly EngineAxis[]; modelId?: string }) => void
  /**
   * 引擎原生长期目标的完整快照。`undefined` 明确表示引擎已清空，不能与“没上报”混同。
   *
   * 目标属于会话而不是某一轮 transcript；宿主据此走 `thread.updated` 落盘，
   * 界面只读展示，不从计划或轮次状态反推。
   */
  onGoal?: (goal: EngineGoal | undefined) => void
  /**
   * omni 设档的**结果**。
   *
   * 存在的理由很具体：`acp/mode.ts` 里那两句「找不到对应项，已保持引擎自己的默认档」
   * 和「没有报告可选档位」以前走 `engine.status` 的 `ready` 档，而 `store` 的 `LOUD`
   * 只收 crashed/timeout/degraded——**代码里写着，用户一次都没看见过**。
   * 改走这里，落进 `Thread` 就能落盘、能补发、⌘R 之后还在。
   */
  onTrustApply?: (result: TrustApply) => void
}

export interface EngineSession {
  readonly threadId: ThreadId
  /** 这条会话实际由哪个引擎 profile 创建；宿主只记录，不解释。 */
  readonly profile?: string
  /**
   * 背后那个引擎进程的 pid（进程组组长，见 `ProcessOwner.pid`）。
   * 几条会话共用一个进程的（kimi web）报的是同一个。**只拿来量它往外发了多少**——
   * omni 不凭它改引擎的任何行为；只在它批量往外发、用户又开着守卫时停掉它。
   */
  pid?: () => number | undefined
  /**
   * 需要在宿主登记会话之后才连接实时流的驱动，把最后一步握手放这里。
   *
   * `start()` 阶段的同步状态仍可走握手快照；但会主动开轮的事件必须等宿主持有
   * thread / turn 身份后再接，否则一个很快收工的原生轮会整段无主。
   */
  activate?: () => Promise<void>
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
   * 实现方要自己守住「递进去的是不是同一轮」：codex 传 `expectedTurnId`；
   * Kimi 则先把第二句排成 queued，再由原生 `prompts:steer` 原子校验仍有同一条 active turn。
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
  /**
   * 问一句不打断主线的问题。**不支持就别实现**（`capabilities().sideQuestion` 报 false），
   * 界面据此不给这个入口。
   *
   * 返回的是答案原文。**问答都不进 transcript**——那正是「侧问」的定义。
   */
  askAside?: (text: string) => Promise<string>
  interrupt: () => Promise<void>
  setTrust: (trust: Trust) => Promise<TrustChange>
  /** 这个引擎能选哪些模型。拿不到就给空数组，界面据此不显示选择器。 */
  models: () => Promise<readonly ModelOption[]>
  /**
   * 换模型。`effort` 只有报了 `efforts` 的引擎会用。
   *
   * **返回的是引擎那边真正生效的强度**，不是你传进去的那个。
   * 两者会不一样：实测 ZCode 的桥把 `thought` 报成「可选 low/high/max」，
   * 而设进去必然 `Internal error`——那一步失败不算换模型失败（模型确实换了），
   * 于是上一版把请求的值原样记进了会话记录，**界面显示「轻度」而引擎在 max**。
   * 界面照着记录画，所以记录必须是真的。
   */
  setModel: (model: string, effort?: string) => Promise<{ effort?: string }>
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
  /**
   * `turnId` 与普通 prompt 一样由宿主铸造。压缩不是一发即忘的按钮：Codex 与
   * Kimi 都会异步报告开始、完成或取消，驱动必须把这些事件落在这轮上并最终发
   * `turn.completed`。只在 RPC 回包时才知道结果的引擎，也在成功回包后自行收工。
   */
  compact?: (turnId: TurnId) => Promise<void>
  /**
   * 引擎自己存着哪些会话（你在终端、在别的界面里跑过的）。
   *
   * **不支持就别实现**——界面据此不显示那一段，不报错。
   * 顺序由驱动定（最近活动在前），omni 原样用。
   */
  history?: () => Promise<readonly EngineThread[]>
  /** 登录的是哪个账号。拿不到给 undefined，界面据此不画。 */
  account?: () => Promise<EngineAccount | undefined>
  /**
   * 这条会话的**原始记录在磁盘上的哪儿**。
   *
   * ## 这条路径只记录、展示，不自动塞给别的引擎
   *
   * 换一家引擎的老做法是：omni 从 transcript 里提炼一份「目标 + 追加要求」，
   * 替用户发给新的那家。两层错——**内容是我编的**（提炼必然丢东西），
   * **动作是我替他做的**（发出去就立刻开跑）。
   *
   * omni 把路径存进 `Thread.segments`，在时间线里展示、供用户复制。
   * 用户明确让另一家 review 时，再把路径给它自己读；omni 不自动注入。
   *
   * 拿不到就给 undefined（比如协议没有这个概念），时间线据实不提供记录入口。
   */
  logPath?: () => Promise<string | undefined>
  /**
   * 这条会话在引擎那边已经有的对话内容。**接管时用来把 transcript 补齐。**
   *
   * 不支持就别实现——那时接过来是一片空白，界面只说明「内容在引擎那边」，
   * 不按引擎名硬编码谁能搬、谁不能搬；公开出口会随版本变化。
   *
   * `total` 大于 `items.length` 表示截断过，调用方要把这件事说出来：
   * 一段被悄悄砍掉一半的历史，比一段明说「只搬了最近这些」糟得多。
   */
  transcript?: () => Promise<{ items: readonly Item[]; total: number }>
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
