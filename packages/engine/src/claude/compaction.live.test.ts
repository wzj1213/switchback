import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { deleteSession } from "@anthropic-ai/claude-agent-sdk"
import type { Event } from "@switchback/protocol"
import { describe, expect, it } from "vitest"
import { createClaudeDriver } from "./driver.js"

/** `pnpm vitest run --mode live packages/engine/src/claude/compaction.live.test.ts` */
describe("Claude 上下文压缩（真跑）", () => {
  it("真实 /compact 从运行态原地更新到带 token 边界的完成态", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-claude-compact-live-"))
    const events: Event[] = []
    let handle: string | undefined
    const session = await createClaudeDriver({ isolateSettings: true }).start({
      threadId: "live-claude-compact",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      onHandle: (id) => { handle = id },
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      for (let index = 1; index <= 6; index += 1) {
        const turnId = `turn-${String(index)}`
        await session.prompt(`只回答数字：${String(index)}`, turnId)
        await waitUntil(() => completed(events, turnId))
      }
      await session.prompt("/compact", "turn-compact")
      await waitUntil(() => completed(events, "turn-compact"))

      const compaction = events.filter((event) =>
        (event.type === "item.started" || event.type === "item.updated")
        && event.item.id === "claude-compaction-turn-compact")
      expect(compaction.at(0)).toMatchObject({ item: { message: "正在压缩上下文…" } })
      expect(compaction.at(-1)).toMatchObject({
        item: { message: expect.stringMatching(/^上下文已压缩：\d+ → \d+ tokens。$/) },
      })
    } finally {
      await session.dispose()
      if (handle !== undefined) await deleteSession(handle, { dir: cwd }).catch(() => undefined)
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 300_000)
})

const completed = (events: readonly Event[], turnId: string): boolean =>
  events.some((event) => event.type === "turn.completed" && event.turnId === turnId)

function waitUntil(done: () => boolean, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (done()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        reject(new Error("等待 Claude 压缩生命周期超时"))
      }
    }, 250)
  })
}
