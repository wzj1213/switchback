import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"
import { createGrokActivity } from "./grok-activity.js"
import { grokNativeApproval } from "./grok.js"

const TURN = "grok-monitor-live"
const DESCRIPTION = "Monitor native output audit"
const FIRST = "OMNI_MONITOR_NATIVE_LINE_1"
const SECOND = "OMNI_MONITOR_NATIVE_LINE_2"

function monitorEvidence(events: readonly Event[]): { output: string; done: boolean } {
  const item = events.find((event) =>
    (event.type === "item.started" || event.type === "item.updated") &&
    event.item.kind === "tool_call" && event.item.tool === "acp:monitor")
  const itemId = item?.type === "item.started" || item?.type === "item.updated" ? item.item.id : undefined
  const output = events.flatMap((event) =>
    event.type === "item.delta" && event.itemId === itemId ? [event.append] : []).join("")
  const done = events.some((event) =>
    event.type === "lane.updated" && event.lane.title === DESCRIPTION && event.lane.status === "done")
  return { output, done }
}

describe("Grok Monitor 输出（真跑）", () => {
  it("原生监控日志回到对应工具卡，并由任务终态收口", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-grok-monitor-"))
    const events: Event[] = []
    let complete: (() => void) | undefined
    const done = new Promise<void>((resolve) => { complete = resolve })
    const driver = createAcpDriver({
      id: "grok",
      command: process.env["OMNI_ACP_COMMAND"] ?? "grok",
      args: process.env["OMNI_ACP_ARGS"]?.split(" ").filter(Boolean)
        ?? ["agent", "stdio", "--debug", "--debug-file", join(cwd, "grok-debug.log")],
      nativeApproval: grokNativeApproval,
      activity: createGrokActivity,
    })
    const session = await driver.start({
      threadId: "live-grok-monitor", cwd, trust: "full", home: homedir(), memory: () => [],
      emit: (event) => {
        events.push(event)
        const evidence = monitorEvidence(events)
        if (evidence.done && evidence.output.includes(FIRST) && evidence.output.includes(SECOND)) complete?.()
      },
      askUser: () => Promise.resolve({ allow: true, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt(
        `Call Monitor exactly once with command \`printf '${FIRST}\\n${SECOND}\\n'\`, ` +
        `description exactly \`${DESCRIPTION}\`, timeout 10000 ms, and persistent false. ` +
        `Do not call Bash or any other tool. After starting it, do not poll or sleep.`,
        TURN,
      )
      await Promise.race([
        done,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("等待 Grok Monitor 输出与终态超时")), 150_000)),
      ])
      const evidence = monitorEvidence(events)
      expect(evidence.output).toContain(`${FIRST}\n${SECOND}\n`)
      expect(evidence.done).toBe(true)
      expect(events).toContainEqual(expect.objectContaining({
        type: "item.delta", threadId: "live-grok-monitor",
      }))
      const itemId = events.flatMap((event) =>
        (event.type === "item.started" || event.type === "item.updated") &&
        event.item.kind === "tool_call" && event.item.tool === "acp:monitor" ? [event.item.id] : [])[0]
      const lastItem = events.findLastIndex((event) =>
        (event.type === "item.started" || event.type === "item.updated") && event.item.id === itemId)
      const lastOutput = events.findLastIndex((event) => event.type === "item.delta" && event.itemId === itemId)
      expect(lastOutput).toBeGreaterThan(lastItem)
    } finally {
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 210_000)
})
