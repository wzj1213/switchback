import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"
import { acpAuthenticate } from "./login.js"

/**
 * 整条链路走一遍：没登录时开会话 → 驱动把 `-32000` 翻成说得出下一步的一句 →
 * 转一次 `authenticate` → 再开就成了。
 *
 * 假 agent 学的是真实 agent 的做法：**凭证存在它自己那儿**（这里是一个标记文件），
 * 所以登录用的那个一次性进程和之后开会话的进程不是同一个，照样认得出登录过。
 * 这正是 omni 敢「另起一个进程去登录」的前提。
 */
const AGENT = `
const fs = require("node:fs")
const path = require("node:path")
const mark = path.join(process.env.FAKE_STATE, "authed")
let buf = ""
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n")
process.stdin.on("data", (d) => {
  buf += d
  const lines = buf.split("\\n")
  buf = lines.pop()
  for (const line of lines) {
    const req = JSON.parse(line)
    if (req.method === "initialize") {
      send({ id: req.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [
        { id: "oauth", name: "Log in with Example" },
        { id: "key", name: "Example API key", _meta: { "api-key": { provider: "example" } } },
      ] } })
    } else if (req.method === "authenticate") {
      fs.writeFileSync(mark, "1")
      send({ id: req.id, result: {} })
    } else if (req.method === "session/new") {
      if (fs.existsSync(mark)) send({ id: req.id, result: { sessionId: "s-1" } })
      else send({ id: req.id, error: { code: -32000, message: "Authentication required", data: { authMethods: [] } } })
    } else if (req.id !== undefined) {
      send({ id: req.id, result: {} })
    }
  }
})
`

function request(cwd: string, events: Event[]): Parameters<ReturnType<typeof createAcpDriver>["start"]>[0] {
  return {
    threadId: "t-auth",
    cwd,
    trust: "auto-edit",
    home: cwd,
    memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("ACP 开会话要先登录", () => {
  it("没登录：说清谁、它的原话、它报的登录方式；登录之后同一条命令就开得起来", async () => {
    const state = mkdtempSync(join(tmpdir(), "omni-fake-acp-"))
    const launch = { command: process.execPath, args: ["-e", AGENT], env: { FAKE_STATE: state } }
    const driver = createAcpDriver({ id: "acp:example", label: "Example Agent", ...launch })
    const events: Event[] = []

    const refused = await driver.start(request(state, events)).catch((error: unknown) => error as Error)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toContain("Example Agent 要先登录")
    expect((refused as Error).message).toContain("Authentication required")
    expect((refused as Error).message).toContain("Log in with Example、Example API key")

    // 另起一个一次性进程去登录——凭证由 agent 自己存
    await expect(acpAuthenticate({ ...launch, cwd: state, methodId: "oauth" })).resolves.toEqual({ ok: true })

    const session = await driver.start(request(state, events))
    expect(session.threadId).toBe("t-auth")
    await session.dispose()
  })
})
