import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createKimiDriver } from "./driver.js"

async function waitForTurn(events: readonly Event[], turnId: string): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "turn.completed" && event.turnId === turnId)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`120 秒内没有等到 ${turnId} 收工：${events.map((event) => event.type).join(", ")}`)
}

/** `pnpm vitest run --mode live packages/engine/src/kimi/compaction.live.test.ts` */
describe("Kimi 上下文压缩（真机）", () => {
  it("真实异步压缩事件原地更新提示并收掉宿主轮次", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-kimi-compaction-live-"))
    const events: Event[] = []
    const session = await createKimiDriver().start({
      threadId: "live-kimi-compaction",
      cwd,
      trust: "full",
      home: process.env["HOME"] ?? "",
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    await session.activate?.()
    try {
      await session.prompt("只回复 OK。", "before")
      await waitForTurn(events, "before")
      await session.compact?.("compact-live")
      await waitForTurn(events, "compact-live")
      const notices = events.flatMap((event) =>
        (event.type === "item.started" || event.type === "item.updated") && event.item.kind === "notice"
          ? [event.item]
          : [],
      )
      expect(notices).toMatchObject([
        { turnId: "compact-live", message: "正在压缩上下文…" },
        { turnId: "compact-live", message: expect.stringMatching(/^上下文已压缩：/) },
      ])
    } finally {
      await session.discard?.().catch(() => undefined)
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 300_000)
})
