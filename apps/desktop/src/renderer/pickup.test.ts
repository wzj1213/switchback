import { describe, expect, it } from "vitest"
import type { EngineSegment, Thread } from "@switchback/protocol"
import { pickupOf } from "./pickup.js"

const seg = (engine: string, startedAt: number, logPath?: string): EngineSegment => ({
  engine,
  handle: `${engine}-h`,
  startedAt,
  ...(logPath === undefined ? {} : { logPath }),
})

function thread(patch: Partial<Thread>): Thread {
  return {
    id: "t1", title: "t", cwd: "/w", engine: "claude", trust: "auto-edit", status: "idle",
    createdAt: 1, updatedAt: 1, engineHistory: ["claude"], ...patch,
  }
}

describe("承接上一段", () => {
  const cases: readonly [name: string, thread: Thread, want: [string, string] | undefined][] = [
    ["没换过引擎就没有可承接的", thread({ segments: [seg("claude", 1, "/a.jsonl")] }), undefined],
    [
      "换过之后承接上一家那份",
      thread({ engine: "codex", segments: [seg("claude", 1, "/a.jsonl"), seg("codex", 2, "/b.jsonl")] }),
      ["/a.jsonl", "claude"],
    ],
    // 这一条是这颗键最常被按的时刻：刚点完下拉，还没说话
    [
      "只点了下拉还没说话时，承接的是当前这家（它正要被交出去）",
      thread({ engine: "claude", nextEngine: "codex", segments: [seg("claude", 1, "/a.jsonl")] }),
      ["/a.jsonl", "claude"],
    ],
    [
      "拿不到本地记录的那一段跳过，往前再找一段",
      thread({
        engine: "kimi",
        segments: [seg("claude", 1, "/a.jsonl"), seg("codex", 2), seg("kimi", 3, "/c.jsonl")],
      }),
      ["/a.jsonl", "claude"],
    ],
    ["谁都没有记录路径时不给这颗键", thread({ engine: "codex", segments: [seg("claude", 1)] }), undefined],
    ["还没跑过任何一轮", thread({}), undefined],
  ]
  for (const [name, value, want] of cases) {
    it(name, () => {
      const got = pickupOf(value)
      expect(got === undefined ? undefined : [got.path, got.engine]).toEqual(want)
    })
  }
})
