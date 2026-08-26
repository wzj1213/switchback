import type { EngineInfo, ThreadId } from "@omni/protocol"
import type { Host } from "@omni/host"
import type { Ledger } from "@omni/wire"
import type { createJournal } from "@omni/journal"
import type { WorktreeBaselines } from "./worktree-baseline.js"
import type { Sinks } from "./sink.js"
import type { Awake } from "./awake.js"
import type { TouchedFiles } from "./touched.js"
import type { AttachmentFiles } from "./attachment-files.js"
import type { Logger } from "./log.js"
import type { WorksiteSearch } from "./worksite-search.js"

/** 桌面壳与宿主接好之后，对窗口、远程入口和退出流程开放的窄表面。 */
export interface Attached {
  host: Host
  baselines: WorktreeBaselines
  /** 回放磁盘上的历史用得到。 */
  journal: ReturnType<typeof createJournal>
  /** 这台机器上注册了哪些引擎；异步探测结果由实现缓存。 */
  engines: () => Promise<readonly EngineInfo[]>
  refreshEngines: () => Promise<void>
  lastThreadId: () => ThreadId | undefined
  ledger: Ledger
  sinks: Sinks
  awake: Awake
  touched: TouchedFiles
  /** omni 自己复制的图片；历史引用与会话删除都在事件出口登记。 */
  attachmentFiles: AttachmentFiles
  worksiteSearch: WorksiteSearch
  log: Logger
  report: (error: unknown, threadId?: ThreadId) => void
}
