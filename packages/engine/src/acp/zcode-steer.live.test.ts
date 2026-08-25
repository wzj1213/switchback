import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"

const TURN = "zcode-steer-live"

function waitFor(done: () => boolean, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (done()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started >= ms) {
        clearInterval(timer)
        reject(new Error("等待 ZCode steer 活体事件超时"))
      }
    }, 25)
  })
}

describe("ZCode · live · steer 兼容边界", () => {
  it("桥会转发 session/steer，但当前后端明确拒绝，不能据此放出入口", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-zcode-steer-"))
    const events: Event[] = []
    const driver = createAcpDriver({
      id: "acp:zcode",
      command: "zcode-acp-server",
      env: { ZCODE_BIN: "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" },
      steer: true,
    })
    const session = await driver.start({
      threadId: "th-live-steer", cwd, trust: "read-only", home: process.env["HOME"] ?? "", memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt("Count from 1 to 1000, one number per line, with no explanation.", TURN)
      await waitFor(() => events.some((event) => event.type === "item.started" && event.item.turnId === TURN), 60_000)
      expect(session.capabilities?.().steer).toBe(true)
      await expect(session.steer?.("Stop counting.")).rejects.toThrow(/Method not found/)
    } finally {
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 180_000)
})
