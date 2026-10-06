import { mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真跑一轮多步任务，验证待办清单变成了 `plan` item。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/claude/plan.live.test.ts
 * ```
 *
 * ## 为什么必须真跑
 *
 * 翻译挂在**原始 `tool_use` 内容块**上（`TaskCreate` 的 `input.subject`、
 * `TaskUpdate` 的 `input.taskId`），而那个形状不在任何类型声明里——
 * 是抓一次真实调用抄下来的。单测钉的是「照这个形状能不能翻对」，
 * 钉不住「真实的形状还是不是这个」。
 *
 * 同时是哨兵：claude 哪天换掉这两个工具（SDK 里 `TodoWrite` 也还声明着），
 * 界面上的计划卡会**安静地不再出现**，而这条测试会红。
 */

describe("claude 的待办清单（真跑）", () => {
  it("多步任务 → transcript 里出现 plan item，且 Task* 不画成工具行", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-plan-live-"))
    for (const f of ["a.txt", "b.txt"]) writeFileSync(join(cwd, f), `${f}\n`)
    const events: Event[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-plan",
      cwd,
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: true, remember: "once" as const }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt(
        "多步任务，务必先用待办清单工具把步骤记下来：1) 读 a.txt 2) 读 b.txt。然后各用一个词总结。",
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
      // 步骤要有人话，不是空壳
      expect(plans.at(-1)?.steps.every((s) => s.text.length > 0)).toBe(true)
      // **待办工具不该同时再画一条工具行**——那是同一件事画两遍
      const toolNames = events
        .filter((e) => e.type === "item.started")
        .map((e) => e.item)
        .filter((i) => i.kind === "tool_call")
        .map((i) => i.tool)
      expect(toolNames.filter((n) => n.startsWith("Task"))).toEqual([])
    } finally {
      await session.dispose()
    }
  }, 300_000)
})
