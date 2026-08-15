import type { EngineId, ItemId, ThreadId } from "./ids.js"
import type { Trust } from "./thread.js"

/** 渲染层 → 宿主的反向指令。宿主是唯一执行者，渲染层不直接碰引擎进程。 */
export type Command =
  | { type: "thread.create"; cwd: string; engine: EngineId; trust: Trust; title?: string }
  | { type: "thread.prompt"; threadId: ThreadId; text: string; attachments?: readonly string[] }
  | { type: "thread.interrupt"; threadId: ThreadId }
  | { type: "thread.setTrust"; threadId: ThreadId; trust: Trust }
  /** 让一个从磁盘回放出来的会话重新接上引擎，带着引擎那边的历史继续。 */
  | { type: "thread.resume"; threadId: ThreadId }
  /** L2 接力：换引擎继续同一个 thread，宿主负责生成交接包。 */
  | { type: "thread.handoff"; threadId: ThreadId; to: EngineId }
  | { type: "approval.resolve"; itemId: ItemId; allow: boolean; remember: RememberScope }

/** 记忆范围。`project` 级会落盘并跨会话生效；红线项不允许 `project`。 */
export type RememberScope = "once" | "session" | "project"
