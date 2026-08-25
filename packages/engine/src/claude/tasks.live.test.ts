import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
 * progress 与 notification 虽有公开类型，但 omni 走的是自己那份窄声明；编译器管不到
 * 「SDK 真的会不会按 started → progress → updated → notification 推完整序列」。
 *
 * 这条同时是哨兵：SDK 哪天改了字段名或终态顺序，它会红，而不是等界面安静地永久旋转。
 *
 * 会消耗真实额度、起真实子进程。
 */

describe("子 agent 进度（真跑）", () => {
  it("起一个 Task 子 agent → 活动进度与 lane 原生终态都完整往返", async () => {
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
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt(
        "用 Task 工具起一个 general-purpose 子 agent，让它读这个目录里的 a.txt 和 b.txt 并各用一个词概括。必须用 Task 工具。",
        "turn-1",
      )
      // `prompt` 不等结果；task_notification 在同一条异步流上，两个条件都要等到。
      await waitUntil(() =>
        events.some((e) => e.type === "turn.completed") &&
        events.some((e) => e.type === "lane.updated" && e.lane.status !== "running"))
      const updates = events.filter((e) => e.type === "tasks.updated")
      expect(updates.length).toBeGreaterThan(0)
      // **每条都得有人话**：那正是 omni 唯一显示的东西
      const described = updates.flatMap((e) => e.tasks).filter((t) => t.description.length > 0)
      expect(described.length).toBeGreaterThan(0)
      // **收工必须清空**，否则界面上那几行会一直挂着
      expect(updates.at(-1)?.tasks).toEqual([])
      const lane = events.filter((e) => e.type === "lane.updated").at(-1)?.lane
      expect(lane).toMatchObject({ status: "done" })
      expect(lane?.summary?.length).toBeGreaterThan(0)
      expect(lane?.progress?.budget?.used).toBeGreaterThan(0)
      const laneItems = events.flatMap((event) =>
        event.type === "item.started" || event.type === "item.updated" ? [event.item] : [],
      ).filter((item) => item.lane?.id === lane?.id)
      expect(laneItems.some((item) => item.kind === "agent_message" && item.text.length > 0)).toBe(true)
      expect(laneItems.some((item) => item.kind === "tool_call")).toBe(true)
    } finally {
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 300_000)
})

function waitUntil(done: () => boolean, timeoutMs = 240_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const id = setInterval(() => {
      if (done()) {
        clearInterval(id)
        resolve()
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(id)
        reject(new Error("等待 Claude task_notification 超时"))
      }
    }, 250)
  })
}
