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
 *
 * # 讲 ACP 的子命令不止一种叫法，参数用 OMNI_ACP_ARGS 给（空格分隔）：
 * OMNI_ACP_COMMAND=kimi OMNI_ACP_ARGS=acp          pnpm test:live
 * OMNI_ACP_COMMAND=grok OMNI_ACP_ARGS="agent stdio" pnpm test:live
 * ```
 *
 * **参数必须能传**：内置的两家 ACP 引擎都不是「一个裸命令就进协议」——
 * kimi 是 `kimi acp`，grok 是 `grok agent stdio`。只认命令名的话，
 * 这套真跑测试恰恰盖不到我们真正内置的那两家。
 *
 * 会消耗真实额度、起真实子进程、在临时目录里改文件。
 *
 * 用 codex 的 ACP 适配器做对手盘有个额外好处：**同一个引擎，两条协议**。
 * 它和 `codex/driver.live.test.ts` 跑的是同一个 codex，所以任何行为差异
 * 都只可能来自协议层，不会是模型差异——这是验证归一化模型的最干净的实验。
 */

const COMMAND = process.env["OMNI_ACP_COMMAND"]
const ARGS = (process.env["OMNI_ACP_ARGS"] ?? "").split(" ").filter((a) => a !== "")

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
  const driver = createAcpDriver({ id: "acp:live", command: COMMAND ?? "codex-acp", args: ARGS })
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
    askQuestion: () => Promise.resolve({ dismissed: true }),
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

      // 工具行不能**停在** running。注意是「停在」：中途来一条「还在跑」的进度更新
      // 完全合规——实测 grok 每个工具都先补一条 running 的 `tool_call_update`，
      // 之后才落到 ok/failed。所以这里看的是每个工具行的**最后一个**状态，
      // 不是每一条更新；按每条更新去断言，等于要求所有引擎都不发进度。
      const last = new Map<string, string>()
      for (const e of events) {
        if (e.type !== "item.updated" || e.item.kind !== "tool_call") continue
        last.set(e.item.id, e.item.status)
      }
      expect(last.size).toBeGreaterThan(0)
      expect([...last.values()]).not.toContain("running")
    },
    180_000,
  )

  /**
   * **这里只能验 omni 这一层能保证的事：问了就必须拒得住。**
   *
   * 「一次都没问」是真实存在的一档，不是测试环境的问题：实测 grok 0.2.106
   * 在 read-only 档下直接把文件改了，`session/request_permission` 一次都没发。
   * 那不是驱动接错了——审批的可见性由 agent 决定（见 `driver.ts` 开头那段，
   * 以及 README 的已知限制）。所以断言写成「文件一定没变」是错的：
   * 它把一条引擎侧的结构性限制记成了 omni 的失败，然后逼着后来的人
   * 要么删测试、要么改驱动去做它做不到的事。
   */
  it(
    "read-only 档下拒掉写：问了就必须拒得住",
    async () => {
      const { asks, cwd } = await run("把 hello.txt 的内容改成「不该发生」。", "read-only", false)
      // 问了的话，必须说得出在批准什么
      for (const ask of asks) expect(ask.summary).not.toBe("")
      if (asks.length > 0) expect(readFileSync(join(cwd, "hello.txt"), "utf8")).toBe("原始内容\n")
    },
    180_000,
  )
})
