import { mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event, QuestionAnswer, QuestionPrompt, QuestionResponse } from "@switchback/protocol"
import { createAcpDriver } from "./driver.js"
import { grokInteraction, grokInteractionResolved } from "./grok-interaction.js"
import { grokNativeApproval } from "./grok.js"

const TURN = "grok-plan-live"
const SENTINEL = "GROK_PLAN_SENTINEL"

function answer(prompts: readonly QuestionPrompt[]): QuestionResponse {
  const answers: Record<string, QuestionAnswer> = {}
  for (const prompt of prompts) {
    const option = prompt.id.endsWith(":plan") ? "approved" : prompt.options[0]?.id
    answers[prompt.id] = option === undefined ? { kind: "skipped" } : { kind: "single", optionId: option }
  }
  return { answers }
}

function finalText(events: readonly Event[]): string {
  return events.flatMap((event) =>
    event.type === "item.updated" && event.item.kind === "agent_message" && event.item.turnId === TURN
      ? [event.item.text]
      : []).join("\n")
}

describe("Grok exit_plan_mode（真跑）", () => {
  it("原生计划正文进入宿主卡，批准后工具继续执行", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-grok-plan-"))
    writeFileSync(join(cwd, "README.md"), "# Audit fixture\n")
    const events: Event[] = []
    const plans: QuestionPrompt[] = []
    let complete: (() => void) | undefined
    const done = new Promise<void>((resolve) => { complete = resolve })
    const driver = createAcpDriver({
      id: "grok",
      command: process.env["SWITCHBACK_ACP_COMMAND"] ?? "grok",
      args: process.env["SWITCHBACK_ACP_ARGS"]?.split(" ").filter(Boolean)
        ?? ["agent", "stdio", "--debug", "--debug-file", join(cwd, "grok-debug.log")],
      nativeApproval: grokNativeApproval,
      interaction: grokInteraction,
      interactionResolved: grokInteractionResolved,
    })
    const session = await driver.start({
      threadId: "live-grok-plan", cwd, trust: "full", home: homedir(), memory: () => [],
      emit: (event) => {
        events.push(event)
        if (event.type === "turn.completed" && event.turnId === TURN) complete?.()
      },
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
      askQuestion: (prompts) => {
        plans.push(...prompts.filter((prompt) => prompt.id.endsWith(":plan")))
        return Promise.resolve(answer(prompts))
      },
    })
    try {
      await session.prompt(
        `Use enter_plan_mode, write a plan with exactly one step to inspect README.md, then call exit_plan_mode. ` +
        `After approval, read README.md without editing it and reply exactly ${SENTINEL}.`,
        TURN,
      )
      await Promise.race([
        done,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("等待 Grok 计划审批回合超时")), 180_000)),
      ])
      expect(plans).toHaveLength(1)
      expect(plans[0]?.body).toContain("README.md")
      expect(plans[0]?.options.map((option) => option.id)).toEqual(["approved", "cancelled", "abandoned"])
      expect(finalText(events)).toContain(SENTINEL)
    } finally {
      await session.dispose()
    }
  }, 240_000)
})
