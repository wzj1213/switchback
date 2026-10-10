import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createAcpDriver } from "./driver.js"

/** 先说一段，等插话；收到插话后回包，再接着说一段才收工。 */
const AGENT = `
let buf = ""
let pending
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n")
const chunk = (text) => send({ method: "session/update", params: { sessionId: "s-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } })
process.stdin.on("data", (d) => {
  buf += d
  const lines = buf.split("\\n")
  buf = lines.pop()
  for (const line of lines) {
    const req = JSON.parse(line)
    if (req.method === "initialize") send({ id: req.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } })
    else if (req.method === "session/new") send({ id: req.id, result: { sessionId: "s-1" } })
    else if (req.method === "session/prompt") { pending = req.id; chunk("先说的一段") }
    else if (req.method === "session/steer") {
      send({ id: req.id, result: {} })
      setTimeout(() => { chunk("收到插话：" + req.params.content); send({ id: pending, result: { stopReason: "end_turn" } }) }, 20)
    }
    else if (req.id !== undefined) send({ id: req.id, result: {} })
  }
})
`

describe("ACP 插话之后的正文", () => {
  it("另起一条，排在插话气泡后面，不追加进插话之前那条", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-acp-steer-"))
    const events: Event[] = []
    const session = await createAcpDriver({
      id: "acp:example", label: "Example", command: process.execPath, args: ["-e", AGENT], steer: true,
    }).start({
      threadId: "t-steer", cwd, trust: "auto-edit", home: cwd, memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    await session.prompt("慢慢做", "t1")
    for (let i = 0; i < 50 && !events.some((event) => event.type === "item.delta"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await session.steer?.("改成用另一个文件")
    for (let i = 0; i < 100 && !events.some((event) => event.type === "turn.completed"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const messages = events.flatMap((event) =>
      event.type === "item.started" && event.item.kind === "agent_message" ? [event.item.id] : [])
    expect(messages).toHaveLength(2)
    const deltas = events.flatMap((event) => (event.type === "item.delta" ? [[event.itemId, event.append]] : []))
    expect(deltas).toEqual([[messages[0], "先说的一段"], [messages[1], "收到插话：改成用另一个文件"]])
    await session.dispose()
  })
})
