import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真插一句进正在跑的那一轮。默认不跑：
 *
 * ```sh
 * pnpm vitest run --mode live packages/engine/src/claude/steer.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * 和 `effort.live.test.ts` 一模一样的处境：**这一条是来推翻一句过期注释的**。
 * `caps.ts` 上原来写着「SDK 没有『往正在跑的那一轮里插一句』的入口」，
 * 而 0.3.231 的 `SDKUserMessage` 上有 `priority?: 'now' | 'next' | 'later'`。
 *
 * 但**类型声明证明不了这件事**：SDK 只把 `priority` 原样转给 CLI 子进程，
 * 真正解释字段的是那个二进制。所以「声明里有」和「真的插得进去」之间隔着
 * 一整个进程，只能让长回答开始吐字后当场叫停。
 *
 * 报 true 的后果是界面上多一颗「立刻插入」，而**入口后面空着比没有入口更糟**
 *（`caps.ts` 抬头那条）。所以这条测试是 `steer: true` 的唯一凭据。
 *
 * 实测 CLI 会先给被打断的一段发 result，再为插话开下一段；测试还要钉住
 * **omni 侧只收工一次**，否则一次插话会把后半段变成无主消息。
 */

/** 让它跑得够久，好在中途插进去。**别让它用工具**——那会把测的东西搅进审批里。 */
const SLOW = "请从 1 数到 800，每个数字单独一行，只输出数字，不要用任何工具，不要省略。"
const CUT_IN = "立即停止原任务，只回复 STEER_OK。"

describe("Claude 当场插话（真跑）", () => {
  it("轮次跑着的时候插进去的话，被**同一轮**吃掉了", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-steer-live-"))
    const events: Event[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-steer",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      const turnId = "t-steer-1"
      await session.prompt(SLOW, turnId)
      await until(() => events.some((e) => e.type === "item.delta"), 120_000)
      expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(0)

      const steer = session.steer
      expect(steer).toBeTypeOf("function")
      if (steer === undefined) throw new Error("Claude 没有暴露 steer")
      await steer.call(session, CUT_IN)
      await until(() => events.some((e) => e.type === "turn.completed"), 120_000)

      // **这一轮只收工一次**：插进去的那句若被当成新的一轮，这里会是 2
      const completions = events.filter((e) => e.type === "turn.completed")
      expect(completions).toHaveLength(1)
      expect(completions[0]).toMatchObject({ turnId })

      const said = events
        .filter((e) => e.type === "item.started")
        .map((e) => (e.type === "item.started" ? e.item : undefined))
        .filter((item) => item?.kind === "agent_message")
        .map((item) => (item !== undefined && "text" in item ? item.text : ""))
        .join("\n")
      expect(said).toContain("STEER_OK")
      expect(said).not.toMatch(/(^|\n)800($|\n)/)
      await new Promise((r) => setTimeout(r, 1000))
      expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1)
      // 没把会话搞崩
      expect(events.filter((e) => e.type === "engine.status" && e.status === "crashed")).toHaveLength(0)
    } finally {
      await session.dispose()
    }
  }, 180_000)
})

/** 等一个条件成立。轮询而不是订阅：事件是推进数组里的，没有现成的 waiter。 */
async function until(ok: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("等超时了")
    await new Promise((r) => setTimeout(r, 100))
  }
}
