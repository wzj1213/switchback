import type { EngineId, Event, Thread } from "@switchback/protocol"
import type { EngineDriver } from "@switchback/engine"
import type { Journal, RuleStore } from "@switchback/journal"

/** 宿主的外部依赖。单独一个文件，`ctx.ts` 要引它而它不该反过来引 ctx。 */

export interface HostDeps {
  drivers: Readonly<Record<EngineId, EngineDriver>>
  /** 用户 home 绝对路径。approval 是纯函数不读环境，得由这里往下传。 */
  home: string
  emit: (event: Event) => void
  /** id 铸造。做成可注入的，测试里就能确定化。 */
  newId: (prefix: string) => string
  now: () => number
  /** 事件落盘。不传就不落——测试与无盘环境都能跑。 */
  journal?: Journal
  /**
   * 审批记忆的落盘。和事件日志分开：事件是某一次会话的流水，
   * 规则是某个**工作区**的长期设置——删会话不该把规则一起删了。
   */
  rules?: RuleStore
  /** 对话开场的真实工作树基线；桌面端用它计算“本次对话”的净差异。 */
  ensureWorktreeBaseline?: (threadId: string, cwd: string) => Promise<void>
  /** 新轮次送出前的真实工作树；桌面端用它计算“上一轮”的净差异。 */
  captureTurnBaseline?: (threadId: string, cwd: string) => Promise<void>
  /** 会话删除时一起回收基线对象。 */
  removeWorktreeBaseline?: (threadId: string) => Promise<void>
  /**
   * 换家后第一句话前面附的交接说明（见 `handoff-note.ts`）。宿主只在那一句上问一次；
   * 返回 undefined＝不附（用户关了「换引擎自动交接」，或者这边写不出来）。
   * 转写落盘、读原始记录都在调用方做：宿主不碰文件。
   */
  handoffBrief?: (thread: Thread) => Promise<string | undefined>
  /**
   * 同时活着的引擎会话上限。超了就把**最久没动的空闲会话**收掉。
   *
   * 不设上限的代价是量出来的：一个 codex 会话 ≈ **260 MB、4 个进程**
   *（app-server 加它自己拉起的那几台 MCP 服务器），三条就是 791 MB。
   * 而 `ctx.live` 原来只在删会话和接力时收缩——开五条会话就是 1.3 GB，
   * 而且它们全都闲着。
   *
   * 收掉的会话不丢东西：日志还在，`engineHandle` 还在，点「继续」就接回来。
   * 缺省见 `session.ts` 的 `DEFAULT_MAX_LIVE`。
   */
  maxLive?: number
}
