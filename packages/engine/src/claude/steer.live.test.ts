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
 * pnpm vitest run packages/engine/src/claude/steer.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * 和 `effort.live.test.ts` 一模一样的处境：**这一条是来推翻一句过期注释的**。
 * `caps.ts` 上原来写着「SDK 没有『往正在跑的那一轮里插一句』的入口」，
 * 而 0.3.231 的 `SDKUserMessage` 上有 `priority?: 'now' | 'next' | 'later'`。
 *
 * 但**类型声明证明不了这件事**，这次尤其如此：`priority` 在 `sdk.d.ts` 里
 * 一行注释都没有，而 `sdk.mjs` 里根本没有处理它的代码——它只是把消息原样转给
 * CLI 子进程，真正解释这个字段的是那个二进制。所以「声明里有」和
 * 「这台机器上真的插得进去」之间隔着一整个进程，只能跑一次看看。
 *
 * 报 true 的后果是界面上多一颗「立刻插入」，而**入口后面空着比没有入口更糟**
 *（`caps.ts` 抬头那条）。所以这条测试是 `steer: true` 的唯一凭据。
 *
 * 同时是哨兵：哪天 CLI 不再认这个字段，这条会红，而不是让那颗按钮安静地失效。
 */

/** 让它跑得够久，好在中途插进去。**别让它用工具**——那会把测的东西搅进审批里。 */
const SLOW = "请从 1 数到 400，每个数字单独一行，只输出数字，不要用任何工具，不要省略。"
const CUT_IN = "停，别数了。只回一个词：叫停成功。"

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
    })
    try {
      const turnId = "t-steer-1"
      await session.prompt(SLOW, turnId)
      // **按墙钟等，不等 `item.delta`**：claude 驱动目前一条 delta 都不发
      //（`includePartialMessages` 没开、`stream_event` 也没接），所以「它开始吐了」
      // 这件事在这条路上根本观察不到。等 1.2 秒，那时长回答一定还在跑
      await new Promise((r) => setTimeout(r, 1200))
      expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(0)

      await session.steer?.(CUT_IN)
      await until(() => events.some((e) => e.type === "turn.completed"), 120_000)

      // **这一轮只收工一次**：插进去的那句若被当成新的一轮，这里会是 2
      const completions = events.filter((e) => e.type === "turn.completed")
      expect(completions).toHaveLength(1)
      expect(completions[0]).toMatchObject({ turnId })

      // **实测结论：插不进去。** 它一路数到了 400，一个字都没听那句叫停
      const said = events
        .filter((e) => e.type === "item.started" || e.type === "item.updated")
        .map((e) => (e.type === "item.started" || e.type === "item.updated" ? e.item : undefined))
        .filter((item) => item?.kind === "agent_message")
        .map((item) => (item !== undefined && "text" in item ? item.text : ""))
        .join("\n")
      expect(said).not.toContain("叫停成功")
      expect(said).toContain("400")

      // 那句话后来去哪儿了：再等一会儿，看它是不是被当成下一轮跑了。
      // **omni 这边收不到**——`turn.completed` 已经把 `ref.current` 清空，
      // 之后到的 assistant 消息会被 `onAssistant` 当作「不属于任何一次请求」丢掉
      await new Promise((r) => setTimeout(r, 8000))
      const late = events.filter((e) => e.type === "item.started").length
      expect(late).toBeGreaterThan(0)
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
