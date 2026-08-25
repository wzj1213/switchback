import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真问一次上下文窗口。默认不跑：
 *
 * ```sh
 * pnpm vitest run --mode live packages/engine/src/claude/window.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * 又是一句「引擎不给」被当成了结论：`usageOf` 上面写着「窗口大小 SDK 不给
 *（它随模型变）」，于是 claude 会话里**顶栏那条比例条、输入框那枚环、
 * 打靶靶纸上那圈有效区全都不出现**——用户看到的是「别家都有，就我这家没有」。
 *
 * 而 `getContextUsage()` 这个控制请求一直摆在那儿。它是控制请求，不是类型字段：
 * 声明里有不代表这台机器上问得到（`steer` 就是这么栽的），所以只能真问一次。
 *
 * 同时是哨兵：哪天这个控制请求改了形状或没了，这条会红，
 * 而不是让那三处比例条安静地消失。
 */

describe("Claude 的上下文窗口（真跑）", () => {
  it("问得到窗口大小，而且跟着用量一起报上来", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-window-live-"))
    const events: Event[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-window",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt("只回一个字：好", "t1")
      await until(() => events.some((e) => e.type === "turn.completed"), 120_000)
      const usage = events.filter((e) => e.type === "usage.updated").at(-1)
      const seen = usage?.type === "usage.updated" ? usage.usage : undefined
      expect(seen).toBeDefined()
      // **这一条是这次改动的全部意义**：以前它永远是 undefined
      expect(seen?.contextWindow).toBeGreaterThan(0)
      // 占用量得说得通：不是零，也不该超过窗口
      expect(seen?.contextUsed).toBeGreaterThan(0)
      expect(seen?.contextUsed).toBeLessThanOrEqual(seen?.contextWindow ?? 0)
      // 生成量也在（上一批接的）
      expect(seen?.outputTokens).toBeGreaterThan(0)
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
