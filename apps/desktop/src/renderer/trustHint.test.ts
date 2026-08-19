import { describe, expect, it } from "vitest"
import type { EngineAxis, Thread, TrustApply } from "@omni/protocol"
import { trustHint } from "./trustHint.js"

const BASE = {
  id: "t1",
  title: "t",
  cwd: "/w",
  engine: "acp:grok",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["acp:grok"],
} as unknown as Thread

const with_ = (patch: Partial<Thread>): Thread => ({ ...BASE, ...patch })
const axis = (match: EngineAxis["match"], id = "plan", label?: string): EngineAxis => ({
  axis: "mode",
  id,
  ...(label === undefined ? {} : { label }),
  match,
})
const apply = (result: TrustApply["result"], detail?: string): TrustApply => ({
  result,
  ...(detail === undefined ? {} : { detail }),
  at: 0,
})

describe("档位说明：四种情形各说一句，其余一个字都不说", () => {
  const CASES: readonly [string, Thread, string | undefined][] = [
    ["全对齐时什么都不说——多一句解释就是多一句噪声", with_({ engineState: { axes: [axis("aligned")], at: 1 } }), undefined],
    ["什么都没报、而这家会报时也不说（会报 = 以观测值为准）", with_({ capabilities: { modeReadback: true } as never }), undefined],
    [
      "**分家要说，而且必须说后半句**",
      with_({ engineState: { axes: [axis("diverged", "plan", "Plan")], at: 1 } }),
      "diverged",
    ],
    ["开会话时定死的，说清楚要重开一条", with_({ trustApply: apply("fixed", "定死了") }), "fixed"],
    ["匹配不上，说清楚只在本机生效", with_({ trustApply: apply("unmapped", "对不上") }), "unmapped"],
    [
      "**读不回来**要和「读得回来、恰好对齐」分开",
      with_({ capabilities: { modeReadback: false } as never }),
      "blind",
    ],
  ]

  for (const [name, thread, kind] of CASES) {
    it(name, () => {
      expect(trustHint(thread, "Grok", "自动编辑")?.kind).toBe(kind)
    })
  }

  it("**`unknown` 不算分家**——引擎报了它在哪一档，但 omni 压根没设过，那不是分家", () => {
    const thread = with_({
      engineState: { axes: [{ axis: "mode", id: "default", match: "unknown" }], at: 1 },
      trustApply: apply("unmapped", "对不上"),
    })
    // 落到 unmapped 那句说明上，而不是常亮一条「引擎那边现在是 X（不是 omni 切的）」
    expect(trustHint(thread, "Grok", "自动编辑")?.kind).toBe("unmapped")
  })

  it("只有 unknown、连 trustApply 都没有时，什么都不说", () => {
    const thread = with_({ engineState: { axes: [{ axis: "mode", id: "default", match: "unknown" }], at: 1 } })
    expect(trustHint(thread, "Grok", "自动编辑")).toBeUndefined()
  })

  it("分家优先于设档结果——前者是此刻正在发生的事实", () => {
    const thread = with_({
      engineState: { axes: [axis("diverged")], at: 1 },
      trustApply: apply("unmapped", "对不上"),
    })
    expect(trustHint(thread, "Grok", "自动编辑")?.kind).toBe("diverged")
  })

  it("**引擎名是插值进去的**，不是写死的字面量", () => {
    const thread = with_({ engineState: { axes: [axis("diverged", "yolo")], at: 1 } })
    expect(trustHint(thread, "ZCode", "只读")?.text).toContain("ZCode")
    expect(trustHint(thread, "ZCode", "只读")?.text).toContain("只读")
  })

  it("引擎没给人话名就显示原样的 id——界面不自己编一个中文名", () => {
    const thread = with_({ engineState: { axes: [axis("diverged", "agent-full-access")], at: 1 } })
    expect(trustHint(thread, "Grok", "完全")?.text).toContain("agent-full-access")
  })

  it("只有分家那一种给动作——其余三种真的没有动作可做", () => {
    expect(trustHint(with_({ engineState: { axes: [axis("diverged")], at: 1 } }), "G", "自动编辑")?.action).toBeDefined()
    expect(trustHint(with_({ trustApply: apply("fixed") }), "G", "自动编辑")?.action).toBeUndefined()
    expect(trustHint(with_({ trustApply: apply("unmapped") }), "G", "自动编辑")?.action).toBeUndefined()
  })

  it("引擎报过状态之后就不再说「读不回来」——它显然会报", () => {
    const thread = with_({
      capabilities: { modeReadback: false } as never,
      engineState: { axes: [axis("aligned")], at: 1 },
    })
    expect(trustHint(thread, "G", "自动编辑")).toBeUndefined()
  })
})
