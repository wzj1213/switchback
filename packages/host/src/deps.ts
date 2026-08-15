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
}
