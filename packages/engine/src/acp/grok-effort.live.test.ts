import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createAcpDriver } from "./driver.js"
import { grokNativeApproval } from "./grok.js"

/**
 * 真验 grok 的强度那条路。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/acp/grok-effort.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * **读**那一半有实测（`session/new` 的回包里 `_meta.reasoningEfforts` 是抄下来的原文），
 * 但**写**那一半是查 grok 自己的客户端源码推出来的：它发
 * `SetSessionModelRequest…meta(REASONING_EFFORT_META_KEY)`。
 * 源码级证据比猜强，但它证明的是「grok 的客户端这么发」，
 * 不是「grok 的 agent 收得下 Switchback 这么发」。只有真发一次才知道。
 *
 * **不跑轮次**：只到 `session/new` + `session/set_model`，几乎不耗配额。
 */

const COMMAND = process.env["SWITCHBACK_ACP_COMMAND"] ?? "grok"
const ARGS = (process.env["SWITCHBACK_ACP_ARGS"] ?? "agent stdio").split(" ").filter((a) => a !== "")

describe("grok 的推理强度（真跑）", () => {
  it("模型清单报得出强度档，而且 set_model 带着 _meta 发得进去", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-grok-effort-"))
    const events: Event[] = []
    const driver = createAcpDriver({
      id: "acp:grok",
      command: COMMAND,
      args: ARGS,
      nativeApproval: grokNativeApproval,
      modeReadback: true,
    })
    const session = await driver.start({
      threadId: "live-grok-effort",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      const models = await session.models()
      const withEffort = models.filter((m) => (m.efforts ?? []).length > 0)
      // 读那一半：一个都没有说明它换了扩展位的键名
      expect(withEffort.length).toBeGreaterThan(0)
      const target = withEffort[0]
      // **挑一个和当前不同的档**，否则「设成了」和「本来就是」分不开
      const level = (target?.efforts ?? []).find((e) => e !== target?.defaultEffort)
      expect(level).toBeDefined()
      // 写那一半：这一发就是本条测试的全部理由
      const applied = await session.setModel(target?.id ?? "", level)
      expect(applied.effort).toBe(level)
      expect(events.filter((e) => e.type === "engine.status" && e.status === "crashed")).toHaveLength(0)
    } finally {
      await session.dispose()
    }
  }, 180_000)
})
