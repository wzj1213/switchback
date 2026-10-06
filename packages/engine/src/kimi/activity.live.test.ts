import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event, Lane } from "@switchback/protocol"
import { createKimiDriver } from "./driver.js"

const MARK = "SWITCHBACK_TASK_OK_5182"

function lanes(events: readonly Event[]): readonly Lane[] {
  return events.filter((event) => event.type === "lane.updated").map((event) => event.lane)
}

function waitFor(label: string, predicate: () => boolean, budget = 150_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + budget
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() >= deadline) {
        clearInterval(timer)
        reject(new Error(`等待 Kimi 真机事件超时：${label}`))
      }
    }, 50)
  })
}

/**
 * 后台任务那条 lane 必须带上引擎自报的**命令原文**。
 *
 * 光有标题和状态时，界面上一条后台任务只剩「跑了个什么 · 已完成」——
 * 用户看到的是「莫名其妙一堆，不知道是啥」。`command` 在 Kimi 公开的
 * `task.started` / `task.terminated` 帧里，这条 live 拿真机核对它确实到得了。
 *
 * **输出不在这条流上**（2026-08-25 真机核对：终止帧只有 command / exitCode /
 * startedAt / endedAt）。它在 REST 那侧的 `output_preview` /
 * `/tasks/{id}?with_output=true`，而 Switchback 现在只在启动与重连时读回任务表——
 * 所以这里不断言 summary，驱动也不假装有。
 */
describe("Kimi 后台任务 · live", () => {
  it(
    "后台 bash 的 lane 带命令原文，跑完保持身份与起始时间",
    async () => {
      const events: Event[] = []
      const driver = createKimiDriver()
      const session = await driver.start({
        threadId: "th-kimi-task-live",
        cwd: mkdtempSync(join(tmpdir(), "switchback-kimi-task-")),
        trust: "full",
        home: process.env["HOME"] ?? "",
        memory: () => [],
        emit: (event) => events.push(event),
        askUser: () => Promise.resolve({ allow: true, remember: "once" }),
        askQuestion: () => Promise.resolve({ dismissed: true }),
      })
      await session.activate?.()
      try {
        await session.prompt(
          `请用 Bash 工具**在后台**（run_in_background / detached）执行 \`sleep 2; printf ${MARK}\`，` +
            "描述写「后台探针」。发起后不要等待、不要读日志，直接回复 DONE。",
          "turn-live",
        )
        await waitFor("后台任务 lane 出现", () => lanes(events).some((lane) => lane.command !== undefined))
        const started = lanes(events).find((lane) => lane.command !== undefined)
        expect(started?.kind).toBe("activity")
        expect(started?.command).toContain(MARK)

        await waitFor("后台任务收工", () =>
          lanes(events).some((lane) => lane.id === started?.id && lane.status !== "running"))
        const ended = lanes(events).filter((lane) => lane.id === started?.id).at(-1)
        expect(ended?.status).toBe("done")
        expect(ended?.command).toContain(MARK)
        // 同一条 lane 从头到尾一个 id、一个起始时间，不因为终止帧换位置
        expect(ended?.id).toBe(started?.id)
        expect(ended?.at).toBe(started?.at)
      } finally {
        await session.discard?.().catch(() => undefined)
        await session.dispose()
      }
    },
    300_000,
  )
})
