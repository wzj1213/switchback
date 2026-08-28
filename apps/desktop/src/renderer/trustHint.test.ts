import { describe, expect, it } from "vitest"
import type { EngineAxis, Thread, TrustApply } from "@omni/protocol"
import { trustBlind, trustHint } from "./trustHint.js"

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

  /**
   * 分家那一句的形状。上一版实测「看不出是什么」，这四条各钉一处毛病，
   * 免得下次有人「顺手改简洁一点」又把它改回去。
   */
  describe("分家那一句：一个轴，两个值，去处写在按钮上", () => {
    const diverged = with_({ engineState: { axes: [axis("diverged", "yolo", "Yolo")], at: 1 } })
    const hint = (): ReturnType<typeof trustHint> => trustHint(diverged, "ZCode", "完全访问")

    it("**先说轴名**：不说的话「Yolo」和「完全访问」读起来像两个不相干的设置", () => {
      expect(hint()?.text).toContain("权限档")
      expect(hint()?.text).toContain("「Yolo」")
      expect(hint()?.text).toContain("「完全访问」")
    })

    it("**omni 侧的档要出现在正文里**——「用户以为自己的档被引擎改掉了」是这句话要防的", () => {
      expect(hint()?.text).toContain("omni 这条会话是「完全访问」")
    })

    it("「不是 omni 切的」挪进悬停：它替自己撇清，不该占第一眼的位置", () => {
      expect(hint()?.text).not.toContain("不是 omni 切的")
      expect(hint()?.tip).toContain("不是 omni 切的")
    })

    it("**按钮说去处**：上面一行常常正好是「切到 Grok」，「切回来」和它撞同一个动词", () => {
      expect(hint()?.action?.label).toBe("改回「完全访问」")
    })

    it("悬停里不枚举红线清单——`redline.ts` 会增减，抄进文案迟早变成一句谎", () => {
      const tip = hint()?.tip ?? ""
      expect(tip).toContain("红线")
      expect(tip).toContain("…")
      expect(tip).toContain("ZCode")
    })
  })

  it("只有分家那一种给动作——其余三种真的没有动作可做", () => {
    expect(trustHint(with_({ engineState: { axes: [axis("diverged")], at: 1 } }), "G", "自动编辑")?.action).toBeDefined()
    expect(trustHint(with_({ trustApply: apply("fixed") }), "G", "自动编辑")?.action).toBeUndefined()
    expect(trustHint(with_({ trustApply: apply("unmapped") }), "G", "自动编辑")?.action).toBeUndefined()
  })

  /**
   * 「这家根本不报」**不进 hint**：它描述的是引擎是什么样、不是此刻发生了什么，
   * 而且永不改变（claude 恒为 false）。常驻就是每条会话上永久挂一行噪音。
   */
  it("读不回来那句不再是常驻提示", () => {
    expect(trustHint(with_({ capabilities: { modeReadback: false } as never }), "G", "自动编辑")).toBeUndefined()
  })
})

describe("「这家不报自己的档」那句话", () => {
  it("这家不报时给得出来——挂在档位选择器的悬停上", () => {
    expect(trustBlind(with_({ capabilities: { modeReadback: false } as never }), "Claude Code")).toContain(
      "Claude Code",
    )
  })

  it("这家会报就不说", () => {
    expect(trustBlind(with_({ capabilities: { modeReadback: true } as never }), "Grok")).toBeUndefined()
    expect(trustBlind(with_({}), "Grok")).toBeUndefined()
  })

  it("**引擎报过状态之后就不再说**——它显然会报，说了就是自相矛盾", () => {
    const thread = with_({
      capabilities: { modeReadback: false } as never,
      engineState: { axes: [axis("aligned")], at: 1 },
    })
    expect(trustBlind(thread, "G")).toBeUndefined()
  })
})
