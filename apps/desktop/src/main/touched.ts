import { resolve } from "node:path"
import type { Event, ThreadId, ToolCallItem, TurnId } from "@omni/protocol"

/**
 * 这条会话**确实读过或改过**的文件。
 *
 * ## 为什么需要它
 *
 * 预览本来只认一条边界：路径必须在工作区里（`file-preview.ts`）。但侧栏那张
 * 「文件」清单列的是**引擎这一轮触达过的文件**，而引擎经常读工作区外的东西——
 * 技能文档、`/tmp` 下的中间产物、它自己那份后台任务日志。实测一条真实会话 28 个文件里
 * 12 个在工作区外，点进去清一色「只能预览当前工作区里的文件」：**列得出来、打不开**。
 *
 * 放宽成「任意路径都能读」是另一个极端——那等于把整块盘交给渲染层。折中是这份名册：
 * **引擎自己报过的路径才准读**，其余照旧挡住。名册由主进程按事件流自己记，
 * 不听渲染层的一面之词。
 *
 * ## 已知限制
 *
 * 每条会话最多记 `PATHS` 条路径、一共最多 `THREADS` 条会话，都按最近触达淘汰；
 * 被淘汰的老路径退回「工作区外」那句提示。同一份文件被引擎按相对路径报、
 * 又按符号链接的另一条路径报时，只有报过的那几条算数。
 */
export interface TouchedFiles {
  /** 直播那条流：item 事件不带 threadId，靠 `turn.started` 认亲。 */
  note: (event: Event) => void
  /** 开窗时从 journal 补历史：那边 threadId 是现成的，不必再认。 */
  noteHistory: (threadId: ThreadId, events: readonly Event[]) => void
  /** `path` 与名册里的原文都按 `cwd` 归一后再比——引擎报的可能是相对路径。 */
  allows: (threadId: ThreadId, cwd: string, path: string) => boolean
}

const THREADS = 40
const PATHS = 1000
const TURNS = 200

function pathsOf(item: ToolCallItem): readonly string[] {
  if (item.detail.kind === "file_read") return [item.detail.path]
  if (item.detail.kind !== "file_edit") return []
  const files = item.detail.files.map((file) => file.path)
  return files.length === 0 ? [item.detail.path] : files
}

/** 重新插一遍 = 顶到队尾；`Map` 的插入序就是这份 LRU。 */
function touch<K, V>(store: Map<K, V>, key: K, value: V, cap: number): void {
  store.delete(key)
  store.set(key, value)
  if (store.size <= cap) return
  const oldest = store.keys().next()
  if (!oldest.done) store.delete(oldest.value)
}

export function createTouchedFiles(): TouchedFiles {
  const threads = new Map<ThreadId, Map<string, true>>()
  const turns = new Map<TurnId, ThreadId>()

  const record = (threadId: ThreadId, event: Event): void => {
    if (event.type !== "item.started" && event.type !== "item.updated") return
    if (event.item.kind !== "tool_call" || event.item.status !== "ok") return
    const paths = threads.get(threadId) ?? new Map<string, true>()
    touch(threads, threadId, paths, THREADS)
    for (const path of pathsOf(event.item)) if (path !== "") touch(paths, path, true, PATHS)
  }

  return {
    note: (event) => {
      if (event.type === "turn.started") {
        touch(turns, event.turn.id, event.turn.threadId, TURNS)
        return
      }
      if (event.type !== "item.started" && event.type !== "item.updated") return
      const threadId = turns.get(event.item.turnId)
      if (threadId !== undefined) record(threadId, event)
    },
    noteHistory: (threadId, events) => {
      for (const event of events) record(threadId, event)
    },
    allows: (threadId, cwd, path) => {
      const paths = threads.get(threadId)
      if (paths === undefined) return false
      const target = resolve(cwd, path)
      for (const raw of paths.keys()) if (resolve(cwd, raw) === target) return true
      return false
    },
  }
}
