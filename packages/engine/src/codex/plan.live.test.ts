import { mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createCodexDriver } from "./driver.js"

/**
 * 真跑一轮多步任务，验证 codex 的 `turn/plan/updated` 变成了 `plan` item。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/codex/plan.live.test.ts
 * ```
 *
 * ## 为什么这条必须存在
 *
 * 写这个翻译的时候**没能亲眼看见线上那条通知**：真起了一次 `codex app-server`，
 * 回来的是 `usageLimitExceeded`（2026-08-19 额度打满）。于是当时的证据只有三样：
 * 方法名在装着的 0.148.0 二进制里搜得到、Rust 结构体与 serde 属性直接读的、
 * `common.rs` 里它没有 `#[experimental]`。**缺的正是一帧真实报文。**
 *
 * 这个会话里已经栽过两次「源码对了但线上不对」：grok 的客户端代码能发不等于服务端收，
 * codex 的 `SandboxPolicy` 同名类型在一个仓库里有两份、我读的是没上线的那份。
 * 所以这条不是补充验证，是**那次验证本身**——额度恢复后跑它。
 *
 * ## 同时是哨兵
 *
 * `status` 的大小写这一处尤其脆：`plan_tool.rs` 的 `StepStatus` 是 snake_case、
 * v2 的 `TurnPlanStepStatus` 是 camelCase，翻译层两种都认。哪天 codex 换掉其中一种，
 * 或者把整份快照改成增量，界面上的计划卡会**安静地停在第一版内容**，而这条会红。
 */

describe("codex 的计划（真跑）", () => {
  it("多步任务 → transcript 里出现 plan item，步骤有人话且状态在推进", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-codex-plan-live-"))
    for (const f of ["a.txt", "b.txt"]) writeFileSync(join(cwd, f), `${f}\n`)
    const events: Event[] = []
    const driver = createCodexDriver({})
    const session = await driver.start({
      threadId: "live-codex-plan",
      cwd,
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: true, remember: "once" as const }),
    })
    try {
      // **钉死模型**：默认那个额度可能是打满的（写这条测试时就是），
      // 而这条验的是通知形状，用哪个模型都一样
      await session.setModel("gpt-5.3-codex-spark", "low")
      await session.prompt(
        "多步任务，先用 update_plan 把步骤记下来：1) 读 a.txt 2) 读 b.txt。然后各用一个词总结。",
        "turn-1",
      )
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          if (events.some((e) => e.type === "turn.completed")) {
            clearInterval(id)
            resolve()
          }
        }, 500)
      })
      const plans = events
        .filter((e) => e.type === "item.started" || e.type === "item.updated")
        .map((e) => e.item)
        .filter((i) => i.kind === "plan")
      expect(plans.length).toBeGreaterThan(0)
      // 步骤要有人话，不是空壳——`step` 字段名错了会得到一串空字符串，而不是报错
      expect(plans.at(-1)?.steps.every((s) => s.text.length > 0)).toBe(true)
      // **状态词认对了没有**：全 `pending` 说明大小写没对上（翻译层认不出就落 pending），
      // 那正是这条测试最想抓的那种「不报错的错」
      expect(plans.at(-1)?.steps.some((s) => s.status !== "pending")).toBe(true)
      // 同一轮里是同一张卡在变，不是每改一步多一张
      expect(new Set(plans.map((p) => p.id)).size).toBe(1)
    } finally {
      await session.dispose()
    }
  }, 300_000)
})
