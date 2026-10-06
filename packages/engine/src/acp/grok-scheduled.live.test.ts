import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { NativeTurnStart } from "../contract.js"
import { createAcpDriver } from "./driver.js"
import { grokNativeApproval } from "./grok.js"
import { grokPromptMeta } from "./grok-hooks.js"
import { grokScheduledTurn } from "./grok-scheduled.js"

const SETUP_TURN = "grok-schedule-setup"
const SCHEDULED_TURN = "grok-schedule-fired"
const SENTINEL = "GROK_SCHEDULED_SENTINEL"

function waitForScheduled(events: readonly Event[], methods: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (!events.some((event) => event.type === "turn.completed" && event.turnId === SCHEDULED_TURN)) return
      clearInterval(timer)
      clearTimeout(deadline)
      resolve()
    }, 100)
    const deadline = setTimeout(() => {
      clearInterval(timer)
      reject(new Error(`等待 Grok 前台定时任务主动续轮超时；收到方法：${[...new Set(methods)].join(", ")}`))
    }, 150_000)
  })
}

function finalText(events: readonly Event[]): string {
  return events.flatMap((event) =>
    event.type === "item.updated" && event.item.kind === "agent_message" && event.item.turnId === SCHEDULED_TURN
      ? [event.item.text]
      : []).join("\n")
}

describe("Grok 前台定时任务（真跑）", () => {
  it("到点通知在当前轮收工后开启带定时来源的下一轮", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-grok-scheduled-"))
    const events: Event[] = []
    const starts: NativeTurnStart[] = []
    const methods: string[] = []
    let active: string | undefined = SETUP_TURN
    let handle: string | undefined
    const driver = createAcpDriver({
      id: "grok",
      command: process.env["SWITCHBACK_ACP_COMMAND"] ?? "grok",
      args: process.env["SWITCHBACK_ACP_ARGS"]?.split(" ").filter(Boolean)
        ?? ["agent", "stdio", "--debug", "--debug-file", join(cwd, "grok-debug.log")],
      nativeApproval: grokNativeApproval,
      promptMeta: grokPromptMeta,
      nativeTurn: grokScheduledTurn,
      notification: (method) => { methods.push(method); return undefined },
    })
    const session = await driver.start({
      threadId: "live-grok-scheduled", cwd, trust: "full", home: homedir(), memory: () => [],
      onHandle: (value) => { handle = value },
      onNativeTurn: (turn) => {
        if (active !== undefined) return undefined
        starts.push(turn)
        active = SCHEDULED_TURN
        return SCHEDULED_TURN
      },
      emit: (event) => {
        events.push(event)
        if (event.type === "turn.completed" && event.turnId === active) active = undefined
      },
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt(
        `Call scheduler_create exactly once with interval "1m", recurring true, durable false, ` +
        `fire_immediately true, foreground true, and prompt "Reply with exactly ${SENTINEL}." ` +
        `You must pass durable=false explicitly. Then finish this turn.`,
        SETUP_TURN,
      )
      await waitForScheduled(events, methods)
      expect(starts).toMatchObject([{
        prompt: `Reply with exactly ${SENTINEL}.`,
        origin: { kind: "scheduled", schedule: "every 1 minute", recurring: true },
      }])
      expect(finalText(events)).toContain(SENTINEL)
      expect(handle).toBeDefined()
    } finally {
      await session.dispose()
    }
  }, 240_000)
})
