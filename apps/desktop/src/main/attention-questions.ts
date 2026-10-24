import type { Event, Thread, ThreadId } from "@switchback/protocol"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ATTENTION_QUESTIONS } from "./attention-questions.messages.js"

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

/**
 * 这条会话现在挂着哪些「等你」：后台问题，和主轮之外来的权限请求（`Thread.pendingApprovals`）。
 * 值是通知里那句话。主轮里的审批卡走转录区那条路（`attention.ts` 的 `approvalOf`）。
 */
function summaries(thread: Thread, locale: Locale): Map<string, string> {
  const m = ATTENTION_QUESTIONS[locale]
  const questions = (thread.pendingQuestions ?? []).map((group) => {
    const first = group.questions[0]
    return [group.id, m.question(first?.header ?? first?.question ?? m.needsAnswer)] as const
  })
  const approvals = (thread.pendingApprovals ?? []).map((one) =>
    [one.id, one.origin === undefined ? m.background(one.summary) : m.subagent(one.summary)] as const)
  return new Map([...questions, ...approvals])
}

function sync(
  known: Map<ThreadId, Map<string, string>>,
  thread: Thread,
  emit: (change: QuestionChange) => void,
  locale: Locale,
): void {
  const before = known.get(thread.id) ?? new Map<string, string>()
  const after = summaries(thread, locale)
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
export function watchQuestions(
  emit: (change: QuestionChange) => void,
  locale: () => Locale = () => DEFAULT_LOCALE,
): QuestionWatch {
  const known = new Map<ThreadId, Map<string, string>>()
  return {
    note: (event) => {
      if (event.type === "thread.started" || event.type === "thread.updated") {
        sync(known, event.thread, emit, locale())
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
