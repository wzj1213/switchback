import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createAcpDriver } from "./driver.js"

/** 收到第一句话就退出的 agent：演崩溃、被外发守卫停掉、OOM。 */
const AGENT = `
let buf = ""
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n")
process.stdin.on("data", (d) => {
  buf += d
  const lines = buf.split("\\n")
  buf = lines.pop()
  for (const line of lines) {
    const req = JSON.parse(line)
    if (req.method === "initialize") send({ id: req.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } })
    else if (req.method === "session/new") send({ id: req.id, result: { sessionId: "s-1" } })
    else if (req.method === "session/prompt") process.exit(3)
    else if (req.id !== undefined) send({ id: req.id, result: {} })
  }
})
`

function start(exits: string[], events: Event[]) {
  const cwd = mkdtempSync(join(tmpdir(), "switchback-acp-exit-"))
  return createAcpDriver({ id: "acp:example", label: "Example", command: process.execPath, args: ["-e", AGENT] }).start({
    threadId: "t-exit", cwd, trust: "auto-edit", home: cwd, memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
    onExit: (detail) => exits.push(detail),
  })
}

const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20))
}

describe("ACP 进程退出", () => {
  it("报一次 onExit；在跑的那一轮落失败", async () => {
    const exits: string[] = []
    const events: Event[] = []
    const session = await start(exits, events)
    await session.prompt("第一句", "t1").catch(() => undefined)
    await until(() => exits.length > 0)
    expect(exits).toEqual(["acp:example 进程已退出（code 3）"])
    await until(() => events.some((event) => event.type === "turn.completed"))
    expect(events.find((event) => event.type === "turn.completed")).toMatchObject({ turnId: "t1", status: "failed" })
    await session.dispose()
    expect(exits).toHaveLength(1)
  })

  it("宿主自己收摊引起的退出不报", async () => {
    const exits: string[] = []
    const session = await start(exits, [])
    await session.dispose()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(exits).toEqual([])
  })
})
