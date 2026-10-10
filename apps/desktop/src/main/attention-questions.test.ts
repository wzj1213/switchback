import type { Event, Thread } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { watchQuestions, type QuestionChange } from "./attention-questions.js"

const thread = (ids: readonly string[]): Thread => ({
  id: "th-1",
  title: "实现登录",
  cwd: "/w",
  engine: "kimi",
  trust: "auto-edit",
  status: "running",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["kimi"],
  pendingQuestions: ids.map((id) => ({
    id,
    questions: [{ id: "choice", header: `问题 ${id}`, question: "选哪一个？", options: [] }],
  })),
})

describe("结构化问题通知差量", () => {
  it("新问题只报一次，落定和删会话都会清掉角标来源", () => {
    const changes: QuestionChange[] = []
    const watch = watchQuestions((change) => changes.push(change))
    const note = (event: Event): void => watch.note(event)

    note({ type: "thread.started", at: 0, thread: thread(["q1", "q2"]) })
    note({ type: "thread.updated", at: 1, thread: thread(["q1", "q2"]) })
    note({ type: "thread.updated", at: 2, thread: thread(["q2"]) })
    note({ type: "thread.removed", at: 3, threadId: "th-1" })

    expect(changes).toEqual([
      { id: "q1", threadId: "th-1", pending: true, summary: "等你回答：问题 q1" },
      { id: "q2", threadId: "th-1", pending: true, summary: "等你回答：问题 q2" },
      { id: "q1", threadId: "th-1", pending: false, summary: "等你回答：问题 q1" },
      { id: "q2", threadId: "th-1", pending: false, summary: "等你回答：问题 q2" },
    ])
  })
})

describe("主轮之外的权限请求也叫人", () => {
  it("新来一张报一次，说清是子 agent 要的；落定就撤", () => {
    const changes: QuestionChange[] = []
    const watch = watchQuestions((change) => changes.push(change))
    const withApproval = (on: boolean): Thread => ({
      ...thread([]),
      ...(on ? { pendingApprovals: [{ id: "ap-1", tool: "Bash", summary: "git push", reason: "r", at: 1, origin: { kind: "subagent" as const, id: "a" } }] } : {}),
    })
    watch.note({ type: "thread.updated", at: 1, thread: withApproval(true) })
    watch.note({ type: "thread.updated", at: 2, thread: withApproval(true) })
    watch.note({ type: "thread.updated", at: 3, thread: withApproval(false) })
    expect(changes).toEqual([
      { id: "ap-1", threadId: "th-1", pending: true, summary: "子 agent 在等你确认：git push" },
      { id: "ap-1", threadId: "th-1", pending: false, summary: "子 agent 在等你确认：git push" },
    ])
  })
})
