import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Thread, Turn } from "@switchback/protocol"
import { nextClockDelay, TurnStatus } from "./TurnStatus.js"

const thread: Thread = {
  id: "th-1",
  title: "测试",
  cwd: "/w",
  engine: "claude",
  trust: "auto-edit",
  status: "running",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["claude"],
}

const turn: Turn = {
  id: "tu-1",
  threadId: thread.id,
  engine: "claude",
  status: "running",
  startedAt: Date.now(),
}

describe("思考 token 状态标签", () => {
  it("有原生估算才显示，并明确它是近似值", () => {
    const base = { thread, turn, items: [], tasks: [] }
    const hidden = renderToStaticMarkup(
      createElement(TurnStatus, { ...base, thinkingTokens: undefined }),
    )
    const shown = renderToStaticMarkup(createElement(TurnStatus, { ...base, thinkingTokens: 4200 }))

    expect(hidden).not.toContain("tokens")
    expect(shown).toContain("约 4.2k tokens")
    expect(shown).toContain("当前思考块的近似值，不是最终用量")
    expect(shown).toContain('aria-hidden="true"')
  })

  it("秒表出现前不逐秒唤醒，出现后对齐整秒", () => {
    const cases: readonly [number, number, number][] = [
      [1_000, 1_000, 15_020],
      [15_999, 1_000, 21],
      [16_000, 1_000, 1_020],
      [16_250, 1_000, 770],
    ]
    for (const [now, startedAt, want] of cases) {
      expect(nextClockDelay(now, startedAt)).toBe(want)
    }
  })
})
