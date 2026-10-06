import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { EngineSession } from "../contract.js"
import { createCodexDriver } from "./driver.js"

async function waitForTurn(events: readonly Event[], turnId: string): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "turn.completed" && event.turnId === turnId)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`120 秒内没有等到 ${turnId} 收工`)
}

function request(cwd: string, events: Event[], onHandle: (handle: string) => void) {
  return {
    threadId: `live-codex-fork-${String(events.length)}`,
    cwd,
    trust: "read-only" as const,
    home: homedir(),
    memory: () => [],
    emit: (event: Event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
    askQuestion: () => Promise.resolve({ dismissed: true as const }),
    onHandle,
  }
}

/**
 * 真跑两轮再从第二轮之前重来，核对新分支的原生持久历史：
 * `pnpm vitest run --mode live packages/engine/src/codex/fork.live.test.ts`
 */
describe("Codex 历史分叉（真机）", () => {
  it("带原生 turn 边界的 thread/fork 保留前一轮并排除后一轮", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-codex-fork-live-"))
    const driver = createCodexDriver()
    const sourceEvents: Event[] = []
    const forkEvents: Event[] = []
    const handles: { source?: string; forked?: string } = {}
    let source: EngineSession | undefined
    let forked: EngineSession | undefined
    try {
      source = await driver.start(request(cwd, sourceEvents, (handle) => { handles.source = handle }))
      await source.setModel("gpt-5.3-codex-spark", "low")
      for (const [text, turnId] of [
        ["只回复 OK。记住标记 SWITCHBACK_FORK_KEEP_824。", "source-1"],
        ["只回复 OK。记住标记 SWITCHBACK_FORK_DROP_824。", "source-2"],
      ] as const) {
        await source.prompt(text, turnId)
        await waitForTurn(sourceEvents, turnId)
      }
      if (handles.source === undefined) throw new Error("源会话没有返回原生句柄")
      forked = await driver.start({
        ...request(cwd, forkEvents, (handle) => { handles.forked = handle }),
        forkOf: { handle: handles.source, dropTurns: 1 },
      })
      const logPath = await forked.logPath?.()
      if (logPath === undefined) throw new Error("分支没有返回原生记录路径")
      const history = readFileSync(logPath, "utf8")
      expect(history).toContain("SWITCHBACK_FORK_KEEP_824")
      expect(history).not.toContain("SWITCHBACK_FORK_DROP_824")
    } finally {
      await forked?.discard?.().catch(() => undefined)
      await forked?.dispose().catch(() => undefined)
      await source?.discard?.().catch(() => undefined)
      await source?.dispose().catch(() => undefined)
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 300_000)
})
