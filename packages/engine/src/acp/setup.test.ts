import { describe, expect, it } from "vitest"
import { capabilitiesOf, canList, contextWindows, effortsOf, modelsOf, sessionsOf } from "./setup.js"

/**
 * ACP 的形状全部来自**实测的 kimi 响应**（`kimi acp`，0.36.1），不是照着协议文档编的。
 */

describe("能力由 agent 自报，不写死", () => {
  const kimi = {
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      sessionCapabilities: { list: {}, resume: {}, close: {}, delete: {}, fork: {} },
    },
  }

  it("**实测的 kimi 握手**：能贴图、能原生分叉", () => {
    expect(capabilitiesOf(kimi)).toEqual({ compact: false, attachments: true, steer: false, fork: true })
  })

  it("**空对象就是「支持」**——ACP 拿它当标记，判据是键在不在，不是值是不是 true", () => {
    expect(capabilitiesOf({ agentCapabilities: { sessionCapabilities: { fork: {} } } }).fork).toBe(true)
    expect(capabilitiesOf({ agentCapabilities: { sessionCapabilities: {} } }).fork).toBe(false)
  })

  it("不报图片能力就不给贴图入口——塞过去会被静默丢掉，比不给更糟", () => {
    expect(capabilitiesOf({ agentCapabilities: {} }).attachments).toBe(false)
  })

  it("compact 和 steer 一律 false：ACP 没有这两个入口（实测 session/compact → Method not found）", () => {
    expect(capabilitiesOf(kimi).compact).toBe(false)
    expect(capabilitiesOf(kimi).steer).toBe(false)
  })

  it("什么都没报时一样不崩", () => {
    expect(capabilitiesOf(undefined).fork).toBe(false)
  })

  it("能不能列历史也看它自己说", () => {
    expect(canList(kimi)).toBe(true)
    expect(canList({ agentCapabilities: { sessionCapabilities: {} } })).toBe(false)
  })
})

describe("推理强度：有的适配器用一个 configOption 表达它", () => {
  const thinking = {
    configOptions: [
      { id: "model", category: "model", currentValue: "k3", options: [{ value: "k3", name: "K3" }] },
      {
        id: "thinking",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "low" }, { value: "high" }, { value: "max" }],
      },
    ],
  }

  it("**实测的 kimi 形状**：low / high / max，当前 high", () => {
    expect(effortsOf(thinking)).toEqual({ efforts: ["low", "high", "max"], current: "high" })
  })

  it("认 category 优先于认 id——id 是各家自己起的名字", () => {
    const odd = { configOptions: [{ id: "reasoning", category: "thought_level", options: [{ value: "a" }] }] }
    expect(effortsOf(odd)?.efforts).toEqual(["a"])
  })

  it("没有这一项就是 undefined——**别报一个空的强度选择器**", () => {
    expect(effortsOf({ configOptions: [{ id: "model", options: [{ value: "x" }] }] })).toBeUndefined()
    expect(effortsOf({})).toBeUndefined()
  })
})

describe("当前模型要标出来", () => {
  it("**configOptions 里 currentValue 那个标 isDefault**——不标的话界面退回列表第一个，那是在撒谎", () => {
    const session = {
      configOptions: [
        {
          id: "model",
          currentValue: "kimi-code/k3",
          options: [{ value: "kimi-code/kimi-for-coding", name: "K2.7" }, { value: "kimi-code/k3", name: "K3" }],
        },
      ],
    }
    expect(modelsOf(session).find((m) => m.isDefault === true)?.label).toBe("K3")
  })

  it("新版走 models.currentModelId 那条路，同样要标", () => {
    const session = {
      models: {
        availableModels: [{ modelId: "a", name: "A" }, { modelId: "b", name: "B" }],
        currentModelId: "b",
      },
    }
    expect(modelsOf(session).find((m) => m.isDefault === true)?.label).toBe("B")
  })
})

describe("历史会话清单", () => {
  const raw = {
    sessions: [
      { sessionId: "s1", cwd: "/w", title: "改分页", updatedAt: "2026-08-16T10:00:00.000Z" },
      { sessionId: "s2", cwd: "/w", title: null, updatedAt: "2026-08-16T12:00:00.000Z" },
      { sessionId: "s3", cwd: "", title: "早期遗留", updatedAt: "2026-08-16T13:00:00.000Z" },
      { cwd: "/w", title: "没有句柄", updatedAt: "2026-08-16T14:00:00.000Z" },
    ],
  }

  it("**最近动过的在前**", () => {
    expect(sessionsOf(raw, 10).map((t) => t.handle)).toEqual(["s2", "s1"])
  })

  it("**没有工作区的不列**——实测 kimi 的清单里真有 `cwd: \"\"` 的旧条目，接过来工作区边界就错了", () => {
    expect(sessionsOf(raw, 10).some((t) => t.handle === "s3")).toBe(false)
  })

  it("没有句柄的不列：接不过来，列出来点了就报错", () => {
    expect(sessionsOf(raw, 10)).toHaveLength(2)
  })

  it("没标题给个占位，不给空字符串（那一行会变成一块空白）", () => {
    expect(sessionsOf(raw, 10).find((t) => t.handle === "s2")?.title).not.toBe("")
  })

  it("有上限", () => {
    expect(sessionsOf(raw, 1)).toHaveLength(1)
  })

  it("时间认不出给 0，**排到最后**——不要编一个「现在」把它顶到最前面", () => {
    const odd = { sessions: [{ sessionId: "x", cwd: "/w", updatedAt: "不是时间" }] }
    expect(sessionsOf(odd, 10)[0]?.updatedAt).toBe(0)
  })

  it("认不出的形状给空数组，不抛", () => {
    expect(sessionsOf(undefined, 10)).toEqual([])
  })
})

/**
 * ACP 没有为「窗口多大」定字段，它在扩展位里：实测 grok 每个模型报
 * `_meta.totalContextTokens`。没有分母就不画比例条，所以这张表不能猜。
 */
describe("上下文窗口大小", () => {
  it("按模型建表", () => {
    expect(
      contextWindows({
        models: {
          currentModelId: "grok-4.6",
          availableModels: [
            { modelId: "grok-4.6", _meta: { totalContextTokens: 500000 } },
            { modelId: "grok-4.5", _meta: { totalContextTokens: 262144 } },
          ],
        },
      }),
    ).toEqual({ "grok-4.6": 500000, "grok-4.5": 262144 })
  })

  it("报不上来的模型不入表——不猜一个分母", () => {
    expect(
      contextWindows({
        models: {
          availableModels: [
            { modelId: "a" },
            { modelId: "b", _meta: null },
            { modelId: "c", _meta: { totalContextTokens: 0 } },
            { _meta: { totalContextTokens: 100 } },
          ],
        },
      }),
    ).toEqual({})
  })

  it("一个模型都没有也不抛", () => {
    expect(contextWindows({})).toEqual({})
  })
})
