import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"
import type { ApprovalAsk } from "../contract.js"

/**
 * 真跑一个 ACP agent，验证驱动在真实线上形状下能跑通。默认不跑：
 *
 * ```sh
 * npm i -g @agentclientprotocol/codex-acp     # 或任一 ACP 适配器
 * OMNI_ACP_COMMAND=codex-acp pnpm test:live
 * ```
 *
 * 会消耗真实额度、起真实子进程、在临时目录里改文件。
 *
 * 用 codex 的 ACP 适配器做对手盘有个额外好处：**同一个引擎，两条协议**。
 * 它和 `codex/driver.live.test.ts` 跑的是同一个 codex，所以任何行为差异
 * 都只可能来自协议层，不会是模型差异——这是验证归一化模型的最干净的实验。
 */

const COMMAND = process.env["OMNI_ACP_COMMAND"]

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "omni-acp-live-"))
  writeFileSync(join(dir, "hello.txt"), "原始内容\n")
  return dir
}

interface Run {
  events: Event[]
  asks: ApprovalAsk[]
  cwd: string
}

async function run(prompt: string, trust: "read-only" | "auto-edit" | "full", allow: boolean): Promise<Run> {
  const cwd = workspace()
  const events: Event[] = []
  const asks: ApprovalAsk[] = []
  const driver = createAcpDriver({ id: "acp:live", command: COMMAND ?? "codex-acp" })
  const session = await driver.start({
    threadId: "live-1",
    cwd,
    trust,
    home: homedir(),
    memory: () => [],
    emit: (e) => events.push(e),
    askUser: (ask) => {
      asks.push(ask)
      return Promise.resolve({ allow, remember: "once" })
    },
  })
  await session.prompt(prompt, "turn-1")
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (events.some((e) => e.type === "turn.completed")) {
        clearInterval(timer)
        resolve()
      }
    }, 200)
    // 兜底：真跑不该没有上限，卡住时要看得见是卡住了而不是「还在想」
    setTimeout(() => {
      clearInterval(timer)
      resolve()
    }, 120_000)
  })
  await session.dispose()
  return { events, asks, cwd }
}

describe.skipIf(COMMAND === undefined)("ACP 驱动真跑", () => {
  it(
    "改一个文件：文件真的变了，事件流说得清发生了什么",
    async () => {
      const { events, cwd } = await run("把 hello.txt 的内容改成「已改」。只做这一件事。", "auto-edit", true)
      expect(readFileSync(join(cwd, "hello.txt"), "utf8")).toContain("已改")

      const completed = events.find((e) => e.type === "turn.completed")
      expect(completed).toMatchObject({ status: "completed" })

      // 文本必须合成条，不能一个 chunk 一条
      const messages = events.filter((e) => e.type === "item.started" && e.item.kind === "agent_message")
      expect(messages.length).toBeGreaterThan(0)
      expect(messages.length).toBeLessThan(5)

      // 工具行不能停在 running
      const tools = events.filter((e) => e.type === "item.updated" && e.item.kind === "tool_call")
      expect(tools.length).toBeGreaterThan(0)
      for (const e of tools) {
        if (e.type !== "item.updated" || e.item.kind !== "tool_call") continue
        expect(e.item.status).not.toBe("running")
      }
    },
    180_000,
  )

  it(
    "read-only 档下拒掉写：文件保持原样，且用户被问过",
    async () => {
      const { asks, cwd } = await run("把 hello.txt 的内容改成「不该发生」。", "read-only", false)
      expect(readFileSync(join(cwd, "hello.txt"), "utf8")).toBe("原始内容\n")
      // 问不问由 agent 决定；问了的话，必须说得出在批准什么
      for (const ask of asks) expect(ask.summary).not.toBe("")
    },
    180_000,
  )
})
