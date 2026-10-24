import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createAntigravityDriver } from "./driver.js"

it("本机 agy 读取隔离文件并通过 conversation ID 续聊", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "switchback-agy-live-"))
  const events: Event[] = []
  const handles: string[] = []
  await writeFile(join(cwd, "probe.txt"), "switchback-agy-72931")
  const session = await createAntigravityDriver().start({
    threadId: "live", cwd, home: cwd, trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event), onHandle: (handle) => handles.push(handle),
    askUser: async () => { throw new Error("headless 没有审批回包") },
    askQuestion: async () => { throw new Error("headless 没有提问回包") },
  })
  try {
    await session.prompt("Use your file-reading tool to read probe.txt. Remember its token and reply with only that token. Do not modify any files.", "one")
    await expect.poll(() => events.find((e) => e.type === "turn.completed"), { timeout: 45_000 }).toBeDefined()
    expect(events.find((e) => e.type === "turn.completed")).toMatchObject({ status: "completed" })
    expect(handles.length).toBe(1)
    expect(events.some((e) => (e.type === "item.started" || e.type === "item.updated") &&
      e.item.kind === "tool_call" && e.item.status === "ok")).toBe(true)
    await session.prompt("What token did I ask you to remember? Reply only with the token. Do not use tools.", "two")
    await expect.poll(() => events.filter((e) => e.type === "turn.completed").length, { timeout: 45_000 }).toBe(2)
    expect(events.findLast((e) => e.type === "turn.completed")).toMatchObject({ status: "completed" })
    expect(events.findLast((e) => e.type === "item.updated")).toMatchObject({
      item: { text: expect.stringContaining("switchback-agy-72931") },
    })
  } finally { await session.dispose(); await rm(cwd, { recursive: true, force: true }) }
}, 100_000)
