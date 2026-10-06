import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真跑一次侧问。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/claude/aside.live.test.ts
 * ```
 *
 * ## 为什么这一条必须真跑
 *
 * `askSideQuestion` 在 0.3.231 的公开类型里还没有，按运行时能力探测。
 * 也就是说编译器帮不上任何忙：签名是我们自己声明的，
 * 参数名、返回形状、以及「它到底能不能在一条真会话上调通」全都只有真跑才知道。
 *
 * 这条测试同时是**哨兵**：哪天 SDK 把这个方法改名或改形状，它会红——
 * 而不是等到用户点了侧问、发现按钮消失（能力位是运行时探测的，方法没了就报 false，
 * 界面上那颗按钮会**安静地不见**，没有任何地方报错）。
 *
 * 会消耗真实额度、起真实子进程。
 */

describe("侧问（真跑）", () => {
  it("能力位报 true，且真问得出一句", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-aside-live-"))
    const events: Event[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-aside",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      // **先看能力位**：它是运行时探测出来的，报 false 就说明这个 SDK 版本没这个方法了
      expect(session.capabilities().sideQuestion).toBe(true)
      const answer = await session.askAside?.("用一个词回答：2 加 2 等于几？")
      expect(typeof answer).toBe("string")
      expect((answer ?? "").length).toBeGreaterThan(0)
      // **一条 item 都不该产生。** 侧问走 lane，不进 transcript——
      // 即使调通了，只要它产出了主线 item，这个功能就是错的
      expect(events.filter((e) => e.type === "item.started")).toHaveLength(0)
      expect(events.filter((e) => e.type === "turn.started")).toHaveLength(0)
    } finally {
      await session.dispose()
    }
  }, 180_000)
})
