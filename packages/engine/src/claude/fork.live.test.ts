import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真分叉一次。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/claude/fork.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * `fork` 这一位刚从 false 翻成 true，而翻它的依据一半是类型声明——
 * **同一批里 `steer` 就是这么栽的**：`priority` 字段明明白白摆在类型里，
 * 真跑一次才发现 CLI 根本不按那个语义兑现。所以这一位也必须有活体证据。
 *
 * 而且这条路上有一处只有真跑才验得出来的东西：**「砍掉最后 N 轮」→ uuid 的翻译**。
 * 那段逻辑本身是纯函数、已经表驱动测过（`fork.test.ts`），但它吃的是
 * Claude 真正写在盘上的 jsonl——那个文件的形状没有任何契约保证。
 * 翻译错了的后果是少带或多带一轮上下文，**而那在界面上完全看不出来**。
 *
 * 判据用暗号：第一轮记一个、第二轮记另一个，然后砍掉最后一轮再问。
 * 记得第一个、不记得第二个，才说明这一刀切在了正确的位置。
 */

const ONE = "记住一个暗号：紫水晶。只回「记住了」三个字。"
const TWO = "再记一个暗号：青柠檬。只回「记住了」三个字。"
const ASK = "我一共告诉过你哪些暗号？只列出来，不要解释。"

describe("Claude 原生分叉（真跑）", () => {
  it("砍掉最后一轮之后，那一轮的上下文真的不在了", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-fork-live-"))
    const first: Event[] = []
    const driver = createClaudeDriver({})
    let handle: string | undefined
    const origin = await driver.start({
      threadId: "live-fork-a",
      cwd,
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (e) => first.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      onHandle: (id) => {
        handle = id
      },
    })
    try {
      await origin.prompt(ONE, "t1")
      await until(() => done(first, "t1"), 120_000)
      await origin.prompt(TWO, "t2")
      await until(() => done(first, "t2"), 120_000)
    } finally {
      await origin.dispose()
    }
    expect(handle).toBeDefined()

    // 岔一条出来，只带第一轮
    const forked: Event[] = []
    const branch = await driver.start({
      threadId: "live-fork-b",
      cwd,
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (e) => forked.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      forkOf: { handle: handle ?? "", dropTurns: 1 },
    })
    try {
      await branch.prompt(ASK, "t3")
      await until(() => done(forked, "t3"), 120_000)
      const said = textOf(forked)
      // 第一轮带过来了……
      expect(said).toContain("紫水晶")
      // ……第二轮被这一刀切掉了。**这一条才是分叉点算得对不对的判据**
      expect(said).not.toContain("青柠檬")
    } finally {
      await branch.dispose()
    }
  }, 180_000)
})

function done(events: readonly Event[], turnId: string): boolean {
  return events.some((e) => e.type === "turn.completed" && e.turnId === turnId)
}

/** 模型说过的话。**从 item 上读**：收尾那条带着全文（见 `stream.ts`）。 */
function textOf(events: readonly Event[]): string {
  return events
    .filter((e) => e.type === "item.started" || e.type === "item.updated")
    .map((e) => (e.type === "item.started" || e.type === "item.updated" ? e.item : undefined))
    .filter((item) => item?.kind === "agent_message")
    .map((item) => (item !== undefined && "text" in item ? item.text : ""))
    .join("\n")
}

/** 等一个条件成立。轮询而不是订阅：事件是推进数组里的，没有现成的 waiter。 */
async function until(ok: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("等超时了")
    await new Promise((r) => setTimeout(r, 100))
  }
}
