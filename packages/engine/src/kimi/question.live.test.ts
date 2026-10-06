import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type {
  Event,
  QuestionAnswer,
  QuestionPrompt,
  QuestionResponse,
} from "@switchback/protocol"
import { createKimiDriver } from "./driver.js"

const MARK = "KIMI_QUESTION_OK_4827"

function waitFor(
  label: string,
  events: readonly Event[],
  predicate: () => boolean,
  budget = 120_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + budget
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() >= deadline) {
        clearInterval(timer)
        reject(new Error(`等待 Kimi 真机事件超时（${label}）：${events.map((event) => event.type).join(", ")}`))
      }
    }, 50)
  })
}

function chooseFirst(questions: readonly QuestionPrompt[]): QuestionResponse {
  const answers: Record<string, QuestionAnswer> = {}
  for (const question of questions) {
    const option = question.options[0]
    if (option === undefined) return { dismissed: true }
    answers[question.id] = question.multiSelect === true
      ? { kind: "multi", optionIds: [option.id] }
      : { kind: "single", optionId: option.id }
  }
  return { answers }
}

describe("Kimi 结构化问题 · live", () => {
  it(
    "真实 AskUserQuestion 从 Web 事件递到宿主，回答后回到同一轮继续执行",
    async () => {
      const events: Event[] = []
      const asked: (readonly QuestionPrompt[])[] = []
      const cwd = mkdtempSync(join(tmpdir(), "switchback-kimi-question-"))
      const session = await createKimiDriver().start({
        threadId: "th-kimi-question-live",
        cwd,
        trust: "full",
        home: process.env["HOME"] ?? "",
        memory: () => [],
        emit: (event) => events.push(event),
        askUser: () => Promise.resolve({ allow: true, remember: "once" }),
        askQuestion: (questions) => {
          asked.push(questions)
          return Promise.resolve(chooseFirst(questions))
        },
      })
      await session.activate?.()
      try {
        await session.prompt(
          `接口验收：必须调用 AskUserQuestion 工具，不要用普通文字提问。只问一个单选题“选择验收方案？”，选项是“方案甲”和“方案乙”。拿到答案后最终只回复 ${MARK}: 加上所选标签。`,
          "turn-question-live",
        )
        await waitFor("结构化问题到达", events, () => asked.length > 0)
        await waitFor("回答后收工", events, () => events.some((event) => event.type === "turn.completed"))

        expect(asked).toMatchObject([
          [{ question: "选择验收方案？", options: [{ label: "方案甲" }, { label: "方案乙" }] }],
        ])
        const text = events
          .filter((event) => event.type === "item.started" || event.type === "item.updated")
          .map((event) => event.item)
          .filter((item) => item.kind === "agent_message")
          .map((item) => item.text)
          .join("\n")
        expect(text).toContain(MARK)
        expect(text).toContain("方案甲")
      } finally {
        await session.discard?.().catch(() => undefined)
        await session.dispose()
        rmSync(cwd, { recursive: true, force: true })
      }
    },
    300_000,
  )
})
