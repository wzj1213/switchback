import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { EngineGoal, Event } from "@switchback/protocol"
import { createCodexDriver } from "./driver.js"

async function waitForGoal(events: readonly Event[], goals: readonly (EngineGoal | undefined)[]): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const settled = events.some((event) => event.type === "turn.completed")
    if (settled && goals.some((goal) => goal?.objective.includes("临时目录") === true)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`120 秒内没有收到原生目标并收工：${JSON.stringify({ goals, events })}`)
}

/** `pnpm vitest run --mode live packages/engine/src/codex/goal.live.test.ts` */
describe("Codex 原生目标（真机）", () => {
  it("模型调用 create_goal 后，稳定通知穿过正式驱动回到宿主回调", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-codex-goal-live-"))
    const events: Event[] = []
    const goals: (EngineGoal | undefined)[] = []
    const session = await createCodexDriver().start({
      threadId: "live-codex-goal",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
      onGoal: (goal) => goals.push(goal),
    })
    try {
      await session.setModel("gpt-5.3-codex-spark", "low")
      await session.prompt(
        "请明确调用 create_goal 创建一个目标：完成这个临时目录的审计。创建后只回复完成。",
        "turn-goal",
      )
      await waitForGoal(events, goals)
      expect(goals).toContainEqual(expect.objectContaining({
        objective: expect.stringContaining("临时目录"),
        status: "active",
        tokensUsed: expect.any(Number),
        timeUsedSeconds: expect.any(Number),
      }))
    } finally {
      await session.interrupt().catch(() => undefined)
      await session.discard?.().catch(() => undefined)
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 180_000)
})
