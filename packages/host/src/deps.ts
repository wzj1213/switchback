import type { EngineId, Event } from "@omni/protocol"
import type { EngineDriver } from "@omni/engine"
import type { Journal, RuleStore } from "@omni/journal"

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
