/**
 * 引擎能做什么。
 *
 * ## 为什么要有这一层
 *
 * 界面上「给不给这个入口」必须只看能力，**不能看引擎叫什么名字**，
 * 也不能嗅探它报上来的命令名。前者一接第四家就得改，后者更脆——
 * 压缩上下文那条一开始就是靠 `commands.some(c => c.name === "compact")` 判的，
 * 而那意味着：某家引擎哪天把命令改名叫 `condense`，omni 会**默默多出一个
 * 重复入口**，没有任何地方报错。
 *
 * 能力由驱动在握手时自报，一路挂在 `Thread` 上传到界面。
 * 新增一种能力时，编译器会逼所有驱动表态——这正是想要的：
 * **一家引擎支不支持某件事，只能由它自己回答。**
 */
export interface EngineCapabilities {
  /**
   * 能压缩上下文（把前面的对话总结掉腾出窗口）。
   *
   * 注意这问的是「**omni 能不能驱动它**」，不是「这家引擎有没有这个概念」。
   * Claude 报 false——它自己的 `/compact` 已经在斜杠命令列表里，
   * omni 再给一个就是同一件事出现两次。
   */
  compact: boolean
  /** 能接收附件（图片、文件）。 */
  attachments: boolean
  /**
   * 能**在一轮跑到一半时改向**——不打断它，也不用等它跑完。
   *
   * 人在 agent 跑的时候最常想做的事就是补一句：「不对，用另一个文件」
   * 「顺便把测试也跑了」。omni 对所有引擎的兜底是**排队**：记下来，
   * 这一轮停了再发。不丢东西，但那句话要等上几十秒才起作用——
   * 而它往往正是「别再往下走了」，等它跑完再说等于白说。
   *
   * codex 的 app-server 有 `turn/steer`，能把话直接递进正在跑的那一轮。
   * Claude 那边 SDK 没有对应入口，报 false，继续排队。
   */
  steer: boolean
  /**
   * 能**带着完整上下文分叉**（原生 fork），而不是只递一份提炼过的目标。
   *
   * omni 对所有引擎的兜底做法是「交接包」：从 transcript 里提炼出目标和
   * 追加要求，起一个全新会话把它发过去。跨引擎时这是**唯一**可能的做法
   *（各家的会话格式不通，硬翻既做不对也维护不起）。
   *
   * 但同一家引擎内部不必这么糙。codex 的 `thread/fork` 复制的是真的会话，
   * 分出来那条**记得它读过哪些文件、写过什么、撞过什么错**。
   * 交接包只有一句目标——「重来」出来的那条会话，其实是从零开始的。
   */
  fork: boolean
  /**
   * 引擎会不会**主动告诉 omni 它自己改了档**。
   *
   * ## 为什么这一位不能省
   *
   * `Thread.engineState` 缺席有两种截然不同的含义：「这家从不报，omni 不知道」，
   * 和「这家会报，现在恰好是对齐的」。不区分的话，界面上这两种长得一模一样。
   *
   * ## 这一位和上面四位不是同一类，别混
   *
   * `compact` / `attachments` / `steer` / `fork` 管的是**给不给入口**——报 false 就不画那个按钮。
   * `modeReadback` 管的是**这条信息可信到什么程度**：报 false 时档位下拉**照给**
   *（omni 设得动，只是读不回来），只是下面多一行灰字。
   * 当成「不给入口」那一类处理、因为读不回来就不让人改档，那是另一个 bug。
   */
  modeReadback: boolean
  /**
   * 能**问一句不打断主线的问题**——问答不进这条会话的 transcript，也不进模型的后续上下文。
   *
   * 只认引擎**自己把它当功能暴露出来**的那种（claude 的 SDK 有
   * `askSideQuestion`，发的是 `subtype:"side_question"` 控制请求）。
   * 拿底层原语替它攒一个（fork 一条临时会话 + 自己塞一段边界提示词）**不算**——
   * 那撞 `AGENTS.md` 的总纲：omni 与引擎是共建者，不是上下级。
   */
  sideQuestion: boolean
}

/** 什么都不支持。驱动没表态时的兜底——**默认不给入口**，而不是默认给。 */
export const NO_CAPABILITIES: EngineCapabilities = {
  compact: false,
  attachments: false,
  steer: false,
  fork: false,
  modeReadback: false,
  sideQuestion: false,
}
