import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真问一次模型清单、真设一次强度。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/claude/effort.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * 这一整条是**推翻一句过期注释**得来的：`models()` 上面原来写着「运行期没有 setter」。
 * 类型声明里现在有 `applyFlagSettings`，但类型只说明「这个方法存在」，
 * 说明不了「这个账号、这个版本上它真的能设进去」。
 *
 * 同时是哨兵：SDK 哪天不再按模型报 `supportedEffortLevels`，
 * 界面上那个强度选择器会**安静地消失**，而这条测试会红。
 */

describe("Claude 的推理强度（真跑）", () => {
  it("模型清单里报得出强度档，而且设得进去", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-effort-live-"))
    const events: Event[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-effort",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
    })
    try {
      const models = await session.models()
      const withEffort = models.filter((m) => (m.efforts ?? []).length > 0)
      // 至少有一个模型报得出强度档——一个都没有说明 SDK 改了字段名
      expect(withEffort.length).toBeGreaterThan(0)
      const target = withEffort[0]
      const level = target?.efforts?.[0]
      expect(level).toBeDefined()
      // **回报的必须是真正生效的那一档**：设不上时回空，调用方保持旧值
      const applied = await session.setModel(target?.id ?? "", level)
      expect(applied.effort).toBe(level)
      // 设强度不该把会话搞崩
      expect(events.filter((e) => e.type === "engine.status" && e.status === "crashed")).toHaveLength(0)
    } finally {
      await session.dispose()
    }
  }, 180_000)
})
