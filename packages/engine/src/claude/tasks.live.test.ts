import { mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createClaudeDriver } from "./driver.js"

/**
 * 真起一个子 agent，验证进度信号一路走到事件流。默认不跑：
 *
 * ```sh
 * pnpm vitest run packages/engine/src/claude/tasks.live.test.ts
 * ```
 *
 * ## 为什么这条必须真跑
 *
 * `task_progress` 的字段名是照着**一次实测抓到的帧**写的（`tasks.ts` 的注释里贴了原文）。
 * 类型声明里有 `SDKTaskProgressMessage`，但 omni 走的是自己那份窄声明——
 * 编译器管不到「SDK 真的会不会推这一帧」。
 *
 * 这条同时是哨兵：SDK 哪天改了字段名，它会红，而不是等到界面上那几行**安静地不再出现**。
 *
 * 会消耗真实额度、起真实子进程。
 */

describe("子 agent 进度（真跑）", () => {
  it("起一个 Task 子 agent → 事件流里出现带人话的 tasks.updated，收工清空", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-tasks-live-"))
    writeFileSync(join(cwd, "a.txt"), "alpha\n")
    writeFileSync(join(cwd, "b.txt"), "beta\n")
    const events: Event[] = []
    const driver = createClaudeDriver({})
    const session = await driver.start({
      threadId: "live-tasks",
      cwd,
      trust: "auto-edit",
      home: homedir(),
      memory: () => [],
      emit: (e) => events.push(e),
      askUser: () => Promise.resolve({ allow: true, remember: "once" as const }),
    })
    try {
      await session.prompt(
        "用 Task 工具起一个 general-purpose 子 agent，让它读这个目录里的 a.txt 和 b.txt 并各用一个词概括。必须用 Task 工具。",
        "turn-1",
      )
      // 等这一轮真的收工——`prompt` 不等结果，收工事件在流里
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          if (events.some((e) => e.type === "turn.completed")) {
            clearInterval(id)
            resolve()
          }
        }, 500)
      })
      const updates = events.filter((e) => e.type === "tasks.updated")
      expect(updates.length).toBeGreaterThan(0)
      // **每条都得有人话**：那正是 omni 唯一显示的东西
      const described = updates.flatMap((e) => e.tasks).filter((t) => t.description.length > 0)
      expect(described.length).toBeGreaterThan(0)
      // **收工必须清空**，否则界面上那几行会一直挂着
      expect(updates.at(-1)?.tasks).toEqual([])
    } finally {
      await session.dispose()
    }
  }, 300_000)
})
