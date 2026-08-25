import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event, ToolCallItem } from "@omni/protocol"
import { createCodexDriver } from "./driver.js"

async function waitForTurn(events: readonly Event[]): Promise<void> {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "turn.completed")) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`180 秒内没有收工：${events.map((event) => event.type).join(", ")}`)
}

function terminalItems(events: readonly Event[]): ToolCallItem[] {
  return events.flatMap((event) => {
    if (event.type !== "item.started" && event.type !== "item.updated") return []
    const item = event.item
    return item.kind === "tool_call" &&
      item.detail.kind === "shell" &&
      item.detail.terminal !== undefined
      ? [item]
      : []
  })
}

/** `pnpm vitest run --mode live packages/engine/src/codex/terminal.live.test.ts` */
describe("Codex 后台终端交互（真机）", () => {
  it("真实 write_stdin 通知把等待与输入并回原命令，并在完成后保留输入", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-codex-terminal-live-"))
    const events: Event[] = []
    const session = await createCodexDriver().start({
      threadId: "live-codex-terminal",
      cwd,
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.setModel("gpt-5.3-codex-spark", "low")
      await session.prompt(
        [
          "严格按三步执行，不要省略第二步：",
          "1. 用 exec_command 启动 `sh -c 'IFS= read -r line; echo GOT:$line'`，yield_time_ms 设为 250。",
          "2. 得到 session_id 后，先用 write_stdin 发送空 chars 轮询一次。",
          "3. 再用 write_stdin 向同一 session_id 写入 `OMNI_TERMINAL_INPUT\\n` 并等它结束。",
          "最后只回复完成。",
        ].join("\n"),
        "turn-terminal",
      )
      await waitForTurn(events)
      const items = terminalItems(events)
      expect(
        items.some((item) => item.detail.kind === "shell" && item.detail.terminal?.waiting),
      ).toBe(true)
      const final = items.findLast((item) => item.status === "ok")
      expect(final?.detail.kind === "shell" ? final.detail.terminal?.inputs : []).toContain(
        "OMNI_TERMINAL_INPUT\n",
      )
    } finally {
      await session.interrupt().catch(() => undefined)
      await session.discard?.().catch(() => undefined)
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 240_000)
})
