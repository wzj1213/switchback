import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { acpAuthenticate, acpLogout } from "./login.js"
import { tryAcp } from "./try.js"

/**
 * 用**真的子进程**测，理由同 `try.test.ts`：这条链路的价值全在隔着 stdio
 * 和一个陌生程序对话上。假 agent 学 claude-agent-acp：**只有客户端声明了
 * terminal 型登录，它才报 terminal 那一种**——所以这里同时验了 Switchback 有没有声明。
 */
const AGENT = (logout: boolean): string => `
let buf = ""
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\\n")
process.stdin.on("data", (d) => {
  buf += d
  const lines = buf.split("\\n")
  buf = lines.pop()
  for (const line of lines) {
    const req = JSON.parse(line)
    if (req.method === "initialize") {
      const caps = req.params.clientCapabilities
      const terminal = caps.auth?.terminal === true && caps._meta?.["terminal-auth"] === true
      send({ id: req.id, result: {
        protocolVersion: 1,
        agentInfo: { name: "fake", version: "9.9.9" },
        agentCapabilities: ${logout ? "{ auth: { logout: {} } }" : "{}"},
        authMethods: [
          { id: "oauth", name: "OAuth" },
          { id: "broken", name: "Broken" },
          { id: "slow", name: "Slow" },
          ...(terminal ? [{ id: "term", name: "Terminal", type: "terminal", args: ["login"] }] : []),
        ],
      } })
    } else if (req.method === "authenticate") {
      const id = req.params.methodId
      if (id === "oauth") send({ id: req.id, result: {} })
      else if (id === "broken") send({ id: req.id, error: { code: -32603, message: "浏览器那边拒绝了" } })
    } else if (req.method === "logout") {
      send({ id: req.id, result: {} })
    }
  }
})
`

const run = (logout = true): { command: string; args: string[]; cwd: string } => ({
  command: process.execPath,
  args: ["-e", AGENT(logout)],
  cwd: tmpdir(),
})

describe("ACP 登录", () => {
  it("试接列出它报的登录方式——terminal 那种只在 Switchback 声明了能跑时才出现", async () => {
    const trial = await tryAcp(run())
    expect(trial.ok).toBe(true)
    expect(trial.authMethods?.map((one) => `${one.id}:${one.kind}`)).toEqual([
      "oauth:agent", "broken:agent", "slow:agent", "term:terminal",
    ])
    expect(trial.logout).toBe(true)
    expect(trial.agent).toEqual({ name: "fake", version: "9.9.9" })
  })

  it("agent 型：转一次 authenticate，它回 {} 就是登上了", async () => {
    await expect(acpAuthenticate({ ...run(), methodId: "oauth" })).resolves.toEqual({ ok: true })
  })

  it("它没办成：原话带回来", async () => {
    const result = await acpAuthenticate({ ...run(), methodId: "broken" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("浏览器那边拒绝了")
  })

  it("terminal 型不许转给 authenticate（协议原文）", async () => {
    const result = await acpAuthenticate({ ...run(), methodId: "term" })
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toContain("终端")
  })

  it("它这一次没报的 id → 说清楚，别硬发", async () => {
    const result = await acpAuthenticate({ ...run(), methodId: "gone" })
    expect(result.error).toContain("没有报")
  })

  it("一直不回：取消得掉，也等得到头", async () => {
    const controller = new AbortController()
    const pending = acpAuthenticate({ ...run(), methodId: "slow", signal: controller.signal })
    setTimeout(() => controller.abort(), 200)
    await expect(pending).resolves.toEqual({ ok: false, error: "已取消。" })
    const timed = await acpAuthenticate({ ...run(), methodId: "slow", timeoutMs: 200 })
    expect(timed.error).toContain("放弃")
  })

  it("退出登录：只对声明了 auth.logout 的发", async () => {
    await expect(acpLogout(run(true))).resolves.toEqual({ ok: true })
    const refused = await acpLogout(run(false))
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain("没有声明")
  })
})
