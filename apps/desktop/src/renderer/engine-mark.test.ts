import { describe, expect, it } from "vitest"
import type { EngineSegment } from "@omni/protocol"
import { engineAt, engineStints, engineSwitches, engineTint } from "./engine-mark.js"

const seg = (engine: string, startedAt: number, profile?: string): EngineSegment => ({
  engine,
  handle: `${engine}-h`,
  startedAt,
  ...(profile === undefined ? {} : { profile }),
})

describe("引擎换手时刻", () => {
  const cases: readonly [name: string, segments: readonly EngineSegment[], want: readonly [string, number][]][] = [
    ["一家跑到底就没有换手", [seg("claude", 10)], []],
    ["第二家起才算一次切换", [seg("claude", 10), seg("codex", 20)], [["codex", 20]]],
    // 这一条正是上一版记不出来的：切回去也是一次换手
    ["切回去也是一次换手", [seg("claude", 10), seg("codex", 20), seg("claude", 30)],
      [["codex", 20], ["claude", 30]]],
    ["旧记录里同一家连着两段不重复画", [seg("claude", 10), seg("claude", 20)], []],
    ["同一家换 profile 算换手", [seg("dsh", 10, "a"), seg("dsh", 20, "b")], [["dsh", 20]]],
    ["没有分段时什么都不画", [], []],
  ]
  for (const [name, segments, want] of cases) {
    it(name, () => {
      expect(engineSwitches(segments).map((s) => [s.engine, s.at])).toEqual(want)
    })
  }
})

describe("某一刻归谁跑", () => {
  const stints = engineStints([seg("claude", 10), seg("codex", 20), seg("claude", 30)])
  const cases: readonly [name: string, at: number, want: string | undefined][] = [
    ["第一段之前没有归属", 5, undefined],
    ["落在段的开始那一刻就算已经换过手", 20, "codex"],
    ["段中间归这一段", 25, "codex"],
    ["最后一段一直管到末尾", 999, "claude"],
  ]
  for (const [name, at, want] of cases) {
    it(name, () => { expect(engineAt(stints, at)?.engine).toBe(want) })
  }
})

describe("引擎配色", () => {
  it("内置五家各有一色，第三方退到中性", () => {
    expect(engineTint("claude")).toBe("var(--engine-claude)")
    expect(engineTint("codex")).toBe("var(--engine-codex)")
    expect(engineTint("some-acp-thing")).toBe("var(--engine-other)")
  })
})
