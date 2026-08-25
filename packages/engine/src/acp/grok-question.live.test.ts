import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event, QuestionPrompt } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"
import { grokInteraction, grokInteractionResolved } from "./grok-interaction.js"
import { grokNativeApproval } from "./grok.js"

const TURN = "grok-question-live"
const SENTINEL = "GROK_QUESTION_SENTINEL:Core"

function finalText(events: readonly Event[]): string {
  return events.flatMap((event) =>
    event.type === "item.updated" && event.item.kind === "agent_message" && event.item.turnId === TURN
      ? [event.item.text]
      : []).join("\n")
}

describe("Grok AskUserQuestion（真跑）", () => {
  it("原生问题进入宿主卡，选择结果只经 reverse-request 回给工具", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-grok-question-"))
    const events: Event[] = []
    const questions: QuestionPrompt[][] = []
    let complete: (() => void) | undefined
    const done = new Promise<void>((resolve) => { complete = resolve })
    const driver = createAcpDriver({
      id: "grok",
      command: process.env["OMNI_ACP_COMMAND"] ?? "grok",
      args: process.env["OMNI_ACP_ARGS"]?.split(" ").filter(Boolean)
        ?? ["agent", "stdio", "--debug", "--debug-file", join(cwd, "grok-debug.log")],
      nativeApproval: grokNativeApproval,
      interaction: grokInteraction,
      interactionResolved: grokInteractionResolved,
    })
    const session = await driver.start({
      threadId: "live-grok-question", cwd, trust: "full", home: homedir(), memory: () => [],
      emit: (event) => {
        events.push(event)
        if (event.type === "turn.completed" && event.turnId === TURN) complete?.()
      },
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
      askQuestion: (prompts) => {
        questions.push([...prompts])
        const id = prompts[0]?.id ?? "missing"
        return Promise.resolve({ answers: { [id]: { kind: "single", optionId: "Core" } } })
      },
    })
    try {
      await session.prompt(
        `Call AskUserQuestion exactly once. Ask exactly "Choose the audit target." with two options: ` +
        `"Core" described as "Inspect core" with preview "CORE_PREVIEW", and ` +
        `"UI" described as "Inspect UI" with no preview. ` +
        `After the user answers, reply exactly ${SENTINEL} and nothing else.`,
        TURN,
      )
      await Promise.race([
        done,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("等待 Grok 问题回合超时")), 150_000)),
      ])
      expect(questions).toHaveLength(1)
      expect(questions[0]).toMatchObject([{
        question: "Choose the audit target.",
        options: [
          { id: "Core", label: "Core", description: "Inspect core", preview: "CORE_PREVIEW" },
          { id: "UI", label: "UI", description: "Inspect UI" },
        ],
      }])
      expect(finalText(events)).toContain(SENTINEL)
    } finally {
      await session.dispose()
    }
  }, 210_000)
})
