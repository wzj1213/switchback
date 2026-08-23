import type { Trust } from "@omni/protocol"
import type { ReclaimConfig } from "../subprocess.js"

/**
 * 一家 ACP 引擎的**注入面**：驱动这一层不认识任何一家，各家的特殊之处从这里递进来。
 *
 * 单独一个文件是因为它不是驱动的实现细节，而是**驱动与各家适配模块之间的契约**
 *（`kimi.ts` / `grok.ts` / `registry.ts` 都照着它填）。放在 driver.ts 里，
 * 读的人得先翻过两百行会话逻辑才看得到「我该提供什么」。
 */
export interface AcpDriverConfig {
  /** 引擎身份，落进事件与判定请求。约定用 `acp:` 前缀，如 `acp:zcode`。 */
  id: string
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  reclaim?: Partial<ReclaimConfig>
  /**
   * 这家把会话记录写到哪。**注入进来而不是驱动自己认**：
   * ACP 协议里根本没有「记录在哪」这个概念，各家各写各的
   * （kimi 的在 `kimi.ts`，grok 的在 `grok.ts`），驱动这一层不该认识
   * 任何一家的目录结构。
   *
   * `cwd` 也一并给出去：有的家**按工作区分目录**（grok 的记录在
   * `sessions/<工作区编码>/<sessionId>/` 下），光有 sessionId 定位不到；
   * 不需要的那家（kimi 查自己的索引）少收一个参数就行。
   *
   * 不给就是拿不到——时间线据实不提供原始记录入口，不由宿主编摘要补齐。
   */
  logPath?: (home: string, sessionId: string, cwd: string) => Promise<string | undefined>
  /**
   * 这家怎么报上下文用量——**只用于协议之外的私有通知**。
   *
   * 标准路子是 `session/update` 的 `usage_update`，那条驱动自己认（实测 kimi
   * 一轮收工推一条 `{used, size}`）。但不是每家都走它：**grok 一条 `usage_update`
   * 都不发**，用量藏在它自己的 `_x.ai/session_notification` 里
   *（`turn_completed` 带 `usage.totalTokens`）。
   *
   * 认这类通知是一家一家的事，所以和 `logPath` 同一个办法注入进来，
   * 驱动这一层不认识任何一家的私有方法名。返回 undefined = 这条通知与用量无关。
   */
  contextUsed?: (method: string, params: unknown) => number | undefined
  /**
   * 同一条私有通知里的缓存命中（只取 read——creation 是写缓存，不是命中）。
   * 和 `contextUsed` 同一条路、同一个理由：协议里没有，各家各报各的。
   * 返回 undefined = 这条通知与用量无关 / 没报——**没报就不显示，不拿 0 冒充没命中**。
   */
  cacheRead?: (method: string, params: unknown) => number | undefined
  /**
   * 这家的**原生审批开关**怎么按信任档设。
   *
   * ACP 的标准做法是 mode（`session/set_mode`），但不是每家都实现：
   * Grok 1.0.5 的审批不在 mode 表里，而在 `session/new` / `session/load` 的
   * `_meta.autoMode` 与 `_meta.yoloMode`。前者接分类器 Auto，后者接 Always-approve。
   *
   * `meta` 并进会话开场的 `_meta`；`note` 可替掉「没报告可选档位」那句通用文案。
   *
   * **只在开会话时生效**：不同值由 `setTrust` 请求续接同一个原生会话重启，
   * 不先写一个尚未生效的新档位。
   */
  nativeApproval?: (trust: Trust) => { meta?: Readonly<Record<string, unknown>>; note?: string }
  /**
   * 这家会不会主动推 `current_mode_update`（见 `EngineCapabilities.modeReadback`）。
   *
   * **协议里没有对应的声明**，握手推不出来，所以只能一家一家给。
   * **默认 false**：不知道就别声称——报 true 而实际不推的代价是界面上那行
   *「引擎侧：X」永远停在开场那一刻，而它长得像实时的。
   */
  modeReadback?: boolean
  /**
   * 这家认不认 `session/compact` / `session/steer`。
   *
   * **协议里推不出来，只能各家自己说**——三家实测的结果见 `turn.ts` 头部那张表
   *（kimi、grok 两个都是 `Method not found`，只有 zcode 有）。
   * 不填就是没有：给一个点了没反应的入口，比不给更糟。
   */
  compact?: boolean
  steer?: boolean
  /**
   * 认不认领 `terminal/*`（替 agent 起进程）。
   *
   * **只给真需要的那家开。** kimi 的 ACP 运行时没有本地兜底，不认领它一条命令都跑不了
   *（实测，见 `terminal.ts`）；而 codex-acp / grok / zcode 自己起进程，
   * 认领了反而是把命令从**它们自己的沙箱里拽出来**——那层沙箱正是判定错了之后的兜底。
   */
  terminal?: boolean
  /**
   * 这家用**私有通知**报「模型 / 强度换了」时，怎么把它认出来。
   *
   * 和 `contextUsed` 同一条路、同一个理由：协议里没有这件事，各家各报各的，
   * 驱动这一层不该认识任何一家的私有方法名。
   *
   * 实测 grok：在自己的 `_x.ai/session_notification` 里推
   * `{sessionUpdate:"model_changed", model_id, reasoning_effort}`——
   * **你在它自己的界面里改了强度，omni 靠这条才跟得上**。
   * 返回 undefined = 这条通知与模型无关。
   */
  modelChanged?: (method: string, params: unknown) => { model?: string; effort?: string } | undefined
}
