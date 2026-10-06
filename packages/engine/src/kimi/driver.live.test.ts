import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createKimiDriver } from "./driver.js"

const MARK = "KIMI_STEER_OK_7319"

function waitFor(label: string, events: readonly Event[], predicate: () => boolean, budget = 120_000): Promise<void> {
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

describe("Kimi Web driver · live", () => {
  it(
    "同一条原生 turn 运行中能 steer，且只有一个 Switchback turn 收工",
    async () => {
      const events: Event[] = []
      const driver = createKimiDriver()
      const session = await driver.start({
        threadId: "th-kimi-web-live",
        cwd: mkdtempSync(join(tmpdir(), "switchback-kimi-web-")),
        trust: "full",
        home: process.env["HOME"] ?? "",
        memory: () => [],
        emit: (event) => events.push(event),
        askUser: () => Promise.resolve({ allow: true, remember: "once" }),
        askQuestion: () => Promise.resolve({ dismissed: true }),
      })
      await session.activate?.()
      try {
        await session.prompt(
          "请立刻使用 Shell 工具执行 `sleep 8; printf KIMI_TOOL_READY`，工具完成后只回复 DONE。",
          "turn-live",
        )
        await waitFor("Shell 已启动", events, () =>
          events.some(
            (event) =>
              event.type === "item.started" &&
              event.item.kind === "tool_call" &&
              event.item.detail.kind === "shell",
          ),
        )
        await session.steer?.(`立即停止原任务，只回复 ${MARK}`)
        await waitFor("steer 后收工", events, () => events.some((event) => event.type === "turn.completed"))
        const text = events
          .filter((event) => event.type === "item.started" || event.type === "item.updated")
          .map((event) => event.item)
          .filter((item) => item.kind === "agent_message")
          .map((item) => item.text)
          .join("\n")
        expect(text).toContain(MARK)
        expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1)
      } finally {
        await session.discard?.().catch(() => undefined)
        await session.dispose()
      }
    },
    300_000,
  )
})
