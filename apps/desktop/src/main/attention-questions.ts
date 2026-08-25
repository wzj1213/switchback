import type { Event, Thread, ThreadId } from "@omni/protocol"

export interface QuestionChange {
  id: string
  threadId: ThreadId
  pending: boolean
  summary: string
}

export interface QuestionWatch {
  note: (event: Event) => void
  clear: () => void
}

function summaries(thread: Thread): Map<string, string> {
  return new Map(
    (thread.pendingQuestions ?? []).map((group) => {
      const first = group.questions[0]
      return [group.id, first?.header ?? first?.question ?? "引擎需要你的回答"]
    }),
  )
}

function sync(
  known: Map<ThreadId, Map<string, string>>,
  thread: Thread,
  emit: (change: QuestionChange) => void,
): void {
  const before = known.get(thread.id) ?? new Map<string, string>()
  const after = summaries(thread)
  for (const [id, summary] of before) {
    if (!after.has(id)) emit({ id, threadId: thread.id, pending: false, summary })
  }
  for (const [id, summary] of after) {
    if (!before.has(id)) emit({ id, threadId: thread.id, pending: true, summary })
  }
  if (after.size === 0) known.delete(thread.id)
  else known.set(thread.id, after)
}

/** 从 Thread 快照的差量里提取「新问题 / 已落定」，重复快照不会重复叫人。 */
export function watchQuestions(emit: (change: QuestionChange) => void): QuestionWatch {
  const known = new Map<ThreadId, Map<string, string>>()
  return {
    note: (event) => {
      if (event.type === "thread.started" || event.type === "thread.updated") {
        sync(known, event.thread, emit)
        return
      }
      if (event.type !== "thread.removed") return
      for (const [id, summary] of known.get(event.threadId) ?? []) {
        emit({ id, threadId: event.threadId, pending: false, summary })
      }
      known.delete(event.threadId)
    },
    clear: () => known.clear(),
  }
}
