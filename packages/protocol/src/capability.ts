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
}

/** 什么都不支持。驱动没表态时的兜底——**默认不给入口**，而不是默认给。 */
export const NO_CAPABILITIES: EngineCapabilities = {
  compact: false,
  attachments: false,
  steer: false,
}
