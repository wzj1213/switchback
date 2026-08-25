import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createClaudeDriver } from "./driver.js"
import type { ApprovalAsk } from "../contract.js"

/**
 * 真跑一次 Claude，验证原生 Auto 模式。默认不跑：
 *
 *   pnpm vitest run packages/engine/src/claude/driver.live.test.ts
 *
 * 会消耗真实额度、起真实子进程、在临时目录里执行命令。
 */

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "omni-live-"))
  writeFileSync(join(dir, "hello.txt"), "omni\n")
  return dir
}

interface Run {
  events: Event[]
  asks: ApprovalAsk[]
}

async function run(prompt: string, answer: boolean, isolate: boolean): Promise<Run> {
  const cwd = workspace()
  const events: Event[] = []
  const asks: ApprovalAsk[] = []
  const driver = createClaudeDriver({ isolateSettings: isolate })
  const session = await driver.start({
    threadId: "live-1",
    cwd,
    trust: "auto-edit",
    home: homedir(),
    memory: () => [],
    emit: (e) => events.push(e),
    askUser: (ask) => {
      asks.push(ask)
      return Promise.resolve({ allow: answer, remember: "once" as const })
    },
    askQuestion: () => Promise.resolve({ dismissed: true }),
  })
  // 轮次由宿主铸造——live test 里我们扮演宿主
  await session.prompt(prompt, "live-turn-1")
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (events.some((e) => e.type === "turn.completed")) {
        clearInterval(timer)
        resolve()
      }
    }, 250)
    setTimeout(() => {
      clearInterval(timer)
      resolve()
    }, 120_000)
  })
  await session.dispose()
  return { events, asks }
}

describe("Claude 驱动 · live", () => {
  it(
    "permissionMode:'auto' 下工作区内安全写入不再来问 omni",
    async () => {
      const { events, asks } = await run(
        "在当前目录创建 safe.txt，内容只写 safe。不要做别的。",
        false,
        false,
      )
      expect(asks).toHaveLength(0)
      expect(events.some((e) => e.type === "turn.completed")).toBe(true)
    },
    180_000,
  )

  it(
    "放行路径能真正执行工具",
    async () => {
      const { events } = await run("读取 hello.txt 并把内容原样告诉我。", true, false)
      const messages = events.filter(
        (e) => e.type === "item.started" && e.item.kind === "agent_message",
      )
      expect(messages.length).toBeGreaterThan(0)
    },
    180_000,
  )
})
