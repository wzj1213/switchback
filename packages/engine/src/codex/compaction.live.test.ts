import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createCodexDriver } from "./driver.js"

async function waitForTurn(events: readonly Event[], turnId: string): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "turn.completed" && event.turnId === turnId)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`120 秒内没有等到 ${turnId} 收工：${events.map((event) => event.type).join(", ")}`)
}

/** `pnpm vitest run --mode live packages/engine/src/codex/compaction.live.test.ts` */
describe("Codex 上下文压缩（真机）", () => {
  it("真实 contextCompaction item 落成提示并用宿主轮次收工", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-codex-compaction-live-"))
    const events: Event[] = []
    const session = await createCodexDriver().start({
      threadId: "live-codex-compaction",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.setModel("gpt-5.3-codex-spark", "low")
      for (const turnId of ["before-1", "before-2"]) {
        await session.prompt("只回复 OK。", turnId)
        await waitForTurn(events, turnId)
      }
      await session.compact?.("compact-live")
      await waitForTurn(events, "compact-live")
      const items = events.flatMap((event) =>
        event.type === "item.started" || event.type === "item.updated" ? [event.item] : [],
      )
      expect(items).toContainEqual(expect.objectContaining({
        turnId: "compact-live",
        kind: "notice",
        message: "上下文已压缩。",
      }))
      expect(items.some((item) => item.kind === "tool_call" && item.tool === "contextCompaction")).toBe(false)
    } finally {
      await session.discard?.().catch(() => undefined)
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 300_000)
})
