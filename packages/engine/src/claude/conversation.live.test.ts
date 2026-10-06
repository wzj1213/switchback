import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真跑 `/clear`：公开类型只能证明事件形状，不能证明 SDK 会在 reset 后把新的可续跑
 * session id 放在哪一帧。2026-08-24 活体确认 conversation_reset 仍带旧 id，下一条 result
 * 才带新 id；这条测试守住驱动、句柄回调和继续对话三段。
 */
describe("Claude /clear（真跑）", () => {
  it("留下上下文分界、切到新原生句柄并继续对话", async () => {
    const events: Event[] = []
    const handles: string[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-clear",
      cwd: mkdtempSync(join(tmpdir(), "switchback-clear-live-")),
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      onHandle: (handle) => handles.push(handle),
      askUser: () => Promise.resolve({ allow: true, remember: "once" as const }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt("只回答一个字：好", "turn-before")
      await waitUntil(() => completed(events, "turn-before"))
      const before = handles.at(-1)
      expect(before).toBeDefined()

      await session.prompt("/clear", "turn-clear")
      await waitUntil(() => completed(events, "turn-clear") && handles.at(-1) !== before)
      expect(events.some((event) => event.type === "usage.cleared")).toBe(true)
      expect(events.find((event) => event.type === "item.started" && event.item.turnId === "turn-clear"))
        .toMatchObject({ item: { kind: "notice", message: expect.stringContaining("不会再读取") } })

      await session.prompt("只回答：新会话", "turn-after")
      await waitUntil(() => completed(events, "turn-after"))
      expect(events.find((event) =>
        event.type === "item.started" && event.item.turnId === "turn-after" && event.item.kind === "agent_message"))
        .toBeDefined()
    } finally {
      await session.dispose()
    }
  }, 300_000)
})

const completed = (events: readonly Event[], id: string): boolean =>
  events.some((event) => event.type === "turn.completed" && event.turnId === id)

function waitUntil(done: () => boolean, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (done()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        reject(new Error("等待 Claude /clear 生命周期超时"))
      }
    }, 250)
  })
}
