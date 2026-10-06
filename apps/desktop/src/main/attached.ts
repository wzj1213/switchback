import type { ThreadId } from "@switchback/protocol"
import type { EngineCatalog } from "./engine-catalog.js"
import type { Host } from "@switchback/host"
import type { Ledger } from "@switchback/wire"
import type { createJournal } from "@switchback/journal"
import type { WorktreeBaselines } from "./worktree-baseline.js"
import type { Sinks } from "./sink.js"
import type { Awake } from "./awake.js"
import type { TouchedFiles } from "./touched.js"
import type { AttachmentFiles } from "./attachment-files.js"
import type { Logger } from "./log.js"
import type { WorksiteSearch } from "./worksite-search.js"
import type { EgressGuard } from "./egress-guard.js"

/**
 * 一次全量重探的回执。
 *
 * **只报「没生效的」**：生效了的那些会随 `engines.available` 事件推过去，
 * 界面自己看得见；而「我看见你改了，但这一次没兑现」是**只有主进程知道**的事，
 * 不说出来它就悄悄消失了——用户会以为改完了。
 */
export interface RescanReport {
  /** `engines.json` 里改过或删掉、这一次不生效的那几家（人话名字）。 */
  needsRestart: readonly string[]
}

/** 桌面壳与宿主接好之后，对窗口、远程入口和退出流程开放的窄表面。 */
export interface Attached {
  host: Host
  baselines: WorktreeBaselines
  /** 回放磁盘上的历史用得到。 */
  journal: ReturnType<typeof createJournal>
  /** 这台机器上注册了哪些引擎；异步探测结果由实现缓存。 */
  engines: EngineCatalog
  /**
   * 重探引擎清单并广播。不给 id 就全部重探、并重读一遍 `engines.json`；见 `host.ts`。
   *
   * 返回的是**这一次没能生效的那几家**：`engines.json` 里改过或删掉的条目
   * 不会在运行期兑现（活着的会话握着旧驱动实例），只能照实说要重启。
   */
  refreshEngines: (id?: string) => Promise<RescanReport>
  lastThreadId: () => ThreadId | undefined
  ledger: Ledger
  sinks: Sinks
  awake: Awake
  touched: TouchedFiles
  /** Switchback 自己复制的图片；历史引用与会话删除都在事件出口登记。 */
  attachmentFiles: AttachmentFiles
  worksiteSearch: WorksiteSearch
  log: Logger
  report: (error: unknown, threadId?: ThreadId) => void
  /** 外发守卫：每个引擎进程往本机外面发了多少，批量外发时停掉它。 */
  egress: EgressGuard
}
