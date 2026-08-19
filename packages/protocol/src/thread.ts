import type { EngineCapabilities } from "./capability.js"
import type { EngineId, ThreadId, TurnId } from "./ids.js"

/**
 * 引擎自己那边的状态。**只读的镜像，不参与任何判定。**
 *
 * 与 `Thread.trust` / `Thread.model` 的关系：那两个是 **omni 设的**，这一份是**引擎报的**。
 * 两者可以不一致，而**不一致本身正是要显示给用户看的东西**。
 *
 * ## 为什么绝不能写进 `Thread.trust`
 *
 * `trust` 有双重身份：它既是「omni 想让引擎处于哪一档」，也是 **omni 本机审批判定器的输入**
 *（`@omni/approval` 的 `decide()` 吃的就是它）。引擎报 yolo 就把它写成 `full`，
 * 等于**顺手把 omni 自己那层审批也关掉**——那是用户从没点过的一次放权，
 * 而且没有任何地方会报错。任何把引擎自报状态直接写进 `Trust` 的做法都是一个静默提权口。
 */
export interface EngineState {
  /**
   * 引擎自报的**每一维**当前值。一维一条，缺席 = 这一维读不回来。
   *
   * 为什么是数组不是一个字段：codex 的档同时落在 `approvalPolicy` 与 `sandboxPolicy`
   * 两个旋钮上，grok 的 mode 轴与审批轴互相独立且后者没有入站信号。
   * 压成一个值就得由驱动现编一个合成 id——那正是「界面显示一个引擎从没说过的东西」。
   */
  axes: readonly EngineAxis[]
  /** 引擎当前实际在用的模型 id。和 `Thread.model`（omni 设的）分开存。 */
  modelId?: string
  /** 这份镜像什么时候报的。**陈旧的镜像比没有更糟**，界面据此判断还显不显示。 */
  at: number
}

export interface EngineAxis {
  /**
   * 这是哪一维。ACP 家填 `"mode"`；codex 填 `"approval"` 与 `"sandbox"` 两条。
   * **omni 不解释这个字符串**，只用它做去重和排序。
   */
  axis: string
  /** 引擎侧原样的值（`"yolo"` / `"bypassPermissions"` / `"dangerFullAccess"`）。**omni 不翻译它。** */
  id: string
  /** 引擎给的人话名。没有就显示 `id`。**界面永远不自己编一个中文名。** */
  label?: string
  /**
   * omni 设的档和这一维**对不对得上**——由**驱动**判定，界面不反推。
   *
   * 反推做不到：`pickMode` 是 Trust→modeId 的打分匹配，有损、多对一，反过来是一对多。
   * 而驱动知道它自己发过什么、引擎回了什么，它答得起。
   */
  match: "aligned" | "diverged"
}

/** omni 最后一次设档的结果。**设不上要说出来**，而不是像以前那样发一条被过滤掉的状态。 */
export interface TrustApply {
  /**
   * `applied` = 发出去了；`unmapped` = 这家的档位表里找不到对应项，保持了它自己的默认档；
   * `fixed` = 这家的开关在开会话时就定死，换档要重开一条会话才生效。
   */
  result: "applied" | "unmapped" | "fixed"
  /** `result !== "applied"` 时给人看的一句话，由驱动给，**必须说得出下一步**。 */
  detail?: string
  at: number
}

/**
 * 一次**侧问**：问一句不打断主线的问题，问答都不进 transcript。
 *
 * ## 为什么挂在 `Thread` 上，而不是做成一种 `Item`
 *
 * `Item` 是 transcript 的构成单位——做成 Item 就得再发明一维「这条属不属于主线」，
 * 而那一维要让五个驱动和两端界面都跟着表态。侧问是**一问一答的纯文本**
 *（claude 的 `askSideQuestion` 返回一个字符串，不是流），没有工具调用、没有轮次，
 * 用不上 Item 的任何东西。挂在 `Thread` 上白捡三样：落盘、⌘R 还在、手机端也能读。
 */
export interface Aside {
  at: number
  question: string
  answer: string
}

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
  /** 引擎自报的状态。**只有驱动写得动，不参与任何判定**（见 `EngineState`）。 */
  engineState?: EngineState
  /** omni 最后一次设档的结果。 */
  trustApply?: TrustApply
  /** 侧问的问答，最早在前。**不进 transcript**，见 `Aside`。 */
  asides?: readonly Aside[]
  /**
   * 下一句话用哪家引擎。**只是意向，还没生效。**
   *
   * ## 为什么开过工的会话切引擎不当场切
   *
   * 当场切要停掉旧进程、起新进程、清掉模型与强度、往 `engineHistory` 里加一笔
   * ——而用户可能只是点开下拉看看有哪几家，或者点错了。那一串副作用发生在
   * 「他还什么都没说」的时候，看起来就是**莫名其妙地变了**。
   * 真正的切换在 `prompt` 里发生（见 `branch.ts` 的 `switchEngine`）。
   *
   * ## 临时会话（`provisional`）反过来：**当场切**
   *
   * 那时没有正在跑的活、没有要保住的上下文、没有一段历史会被打断——
   * 推迟唯一的效果是让你在开口之前**挑不了模型**（模型清单是引擎起来之后
   * 才报的），而「先挑引擎和模型再说第一句」正是新会话最常见的开法。
   * 所以这个字段只会出现在**已经发过话的会话**上。
   *
   * 与 `engine` 相同或缺席都表示「没有待切换的」。
   */
  nextEngine?: EngineId
  /**
   * **还没发出第一句话的临时会话。**
   *
   * 点一下「+」、或者 omni 启动时自动开的那条，都是这种：引擎已经起好了
   *（所以模型清单、斜杠命令都能用），但它还什么都没发生。
   *
   * 界面据此**不把它放进侧栏**——你以为自己只是点开看看，结果攒出一串
   * 「新会话」还得一条条删。宿主据此**不落盘**（见 `Ctx.uncommitted`）、
   * 切引擎**当场生效**（见 `nextEngine`）、建新的临时会话时**把旧的收掉**。
   *
   * 发出第一句话的那一刻由宿主清掉（见 `prompt.ts`）：那一刻它才算存在。
   */
  provisional?: boolean
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
  /**
   * 排着队等这一轮跑完再发的话。
   *
   * **不是"禁止输入"的替代品，是它的反面。** 以前轮次跑着时输入框直接禁用，
   * 想补一句「不对，用另一个文件」只能先中断——而中断意味着丢掉它已经做的一半。
   * 现在照打照发，排进队里，这一轮一停就接上。
   *
   * 队列**不跨重启**：引擎都换过一个了，那句话的上下文已经不在。
   */
  queued?: readonly string[]
  /**
   * 用户在哪一轮上点过「本轮剩下的都放行」。
   *
   * **摆在协议里是为了让它看得见。** 一个「接下来不再问你」的开关如果只活在
   * 宿主内存里，界面上就没有任何痕迹——而这正是最不该沉默的一类状态。
   *
   * 存轮次 id 而不是布尔，界面据此**自己判断还生不生效**（和当前轮次比一比），
   * 不需要谁在轮次结束时记得来清一次。见 `host/approval.ts`。
   */
  passTurn?: TurnId
  /**
   * 这个会话背后的引擎能做什么。握手时由驱动自报。
   *
   * **界面只看它，不看 `engine` 是哪家。** 回放出来的历史会话没有这一项
   * （引擎都没起），那时界面按「都不支持」处理，正好——那些入口本来也点不动。
   */
  capabilities?: EngineCapabilities
  /**
   * 这条会话属不属于一个项目。
   *
   * - `"project"`（缺省）：挂在某个代码目录下，侧栏按项目分组
   * - `"chat"`：**不需要先有项目就能开的对话**。它仍然有 `cwd`
   *   （自动建在 `~/Documents/omni/` 下），只是不进项目树
   *
   * ## 为什么 `cwd` 不做成可空
   *
   * `cwd` 是**工作区边界的唯一真源**：子进程拿它当工作目录（空了就继承主进程的，
   * 打包后是 `/`），审批规则按它分桶（空了就全部并成一桶——
   * 在 A 对话点的「一直允许」会在 B 对话生效）。给对话自动生成一个真目录，
   * 比让 `cwd` 可空安全得多，代价只是磁盘上多几个空文件夹。
   *
   * 缺省视作 `"project"`，老记录回放行为不变，不需要迁移。
   */
  workspaceKind?: "project" | "chat"
  /**
   * 这条会话在各家引擎那边**分别**留下的段落。
   *
   * ## 为什么一条会话要记好几个句柄
   *
   * 上一版换引擎时把 `engineHandle` 清成 undefined——「换了引擎，上一家的句柄
   * 就没用了」。于是**切回去回不到原来那条 session**：codex 跑了一半，切去
   * Claude 看一眼，再切回来时 codex 已经不记得自己做过什么了。
   *
   * 记成分段之后：切回哪一家就续上哪一家自己的那条，
   * 而每一段的 `logPath` 让**别的引擎有需要时自己去读**——
   * 不注入、不强制，你让它 review 它才去读，读到的是全量原文。
   *
   * **有实际对话才记**（第一轮开始时才落一段）：切过去没说话就切走，
   * 不该在时间线上留一条什么都没发生的记录。
   */
  segments?: readonly EngineSegment[]
  /**
   * **还没发出去的一段话**，界面开这条会话时把它填进输入框。
   *
   * 目前只有一个来源：跨引擎分叉 / 接力时的交接包。
   *
   * ## 为什么不直接替用户发出去
   *
   * 上一版是发出去的——于是「分叉一份」变成了「分叉一份**并且立刻开始跑**」，
   * 而用户只是想开个副本待会儿再说。更糟的是那段交接包是 omni 替他写的：
   * 一条他没打过的话，以他的名义进了 transcript，还立刻花掉一轮额度。
   *
   * 放进输入框之后，它是一份**草稿**：看得见、能改、要不要发你说了算。
   *
   * 发出第一句话时由宿主清掉（见 `prompt.ts`）——那时它已经不是「待发」了。
   */
  draft?: string
  /**
   * 这条会话是**从引擎那边接过来的**，不是 omni 建的。
   *
   * 界面靠它说清楚一件事：前面的内容在引擎那边，omni 这里没有记录。
   * 不标的话，用户打开看到一片空白，会以为上下文丢了——
   * 而它其实什么都记得。**「看起来丢了但其实没丢」比真丢了更难受。**
   */
  adopted?: boolean
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
  /**
   * 这条命令是**哪儿来的**：你自己装的、这个项目带的、还是引擎自带的。
   *
   * codex 的 `skills/list` 每条都报 `scope`（实测取值 `user` / `system`），
   * 它的面板把这一列画在最右边。这不是装饰——一条 `system` 的技能是厂商
   * 塞进来的，一条 `user` 的是你自己写的，**出了问题该去改哪儿完全不同**。
   *
   * 报不上来就缺席，界面据此什么都不画。
   */
  scope?: "user" | "project" | "system"
}

/**
 * **引擎自己存的一条会话**——不是 omni 建的。
 *
 * codex 在终端里、在 ChatGPT.app 里跑过的对话都躺在它自己的记录里
 *（`thread/list`，这台机器上 25 条）。omni 的定位是「统一各家原生 agent」，
 * 那么「你在别处跑的那些」本来就该看得见、接得上。
 *
 * **只带得动列表，带不动内容**：codex 的 `thread/items/list` 目前明确回
 * `not supported yet`（实测）。所以接过来的会话在 omni 这边 transcript 是空的，
 * 而引擎那边记得一切——这个落差必须在界面上说出来，不能让人以为内容丢了。
 */
export interface EngineThread {
  /** 引擎侧句柄。omni 靠它把这条会话接过来续跑。 */
  handle: string
  title: string
  /** 它当初开在哪个目录。接过来时沿用，不然工作区边界就错了。 */
  cwd: string
  /** 最后活动时间（毫秒）。 */
  updatedAt: number
}

/**
 * 引擎登录的是哪个账号。
 *
 * 摆出来是因为**它决定了额度算在谁头上**——一台机器上换过号的人，
 * 「剩余 12%」是谁的 12% 是个真问题。
 */
export interface EngineAccount {
  /** 给人看的：邮箱或用户名。 */
  label: string
  /** 套餐（实测 codex 报 `prolite`）。报不上来就缺席。 */
  plan?: string
}

/**
 * 一条会话在某一家引擎那边的一段。
 *
 * 「段」的边界是**换引擎**：codex 跑三轮、切 Claude 跑两轮、再切回 codex，
 * 就是三段——而第三段续的是第一段那个句柄，不是新开一条。
 */
export interface EngineSegment {
  engine: EngineId
  /**
   * 引擎侧的会话句柄（codex 的 thread id、Claude 的 session id）。
   * 界面上可复制——你可能想拿它去引擎自己的界面里翻。
   */
  handle: string
  /**
   * 原始记录在磁盘上的路径。
   *
   * **这是换引擎时唯一要交接的东西**：别的引擎有文件工具，
   * 你让它 review 前面的活，它自己去读这个文件就行——
   * 比 omni 提炼一份摘要塞给它准确得多，而且不问就不读。
   */
  logPath?: string
  startedAt: number
}