import { describe, expect, it } from "vitest"
import { toHistory, toLimits, toModels } from "./catalog.js"

describe("Kimi 清单翻译", () => {
  it("模型保留原生强度并标出 Kimi 的默认项", () => {
    const models = toModels(
      [
        { provider: "p", model: "k2", display_name: "K2" },
        { provider: "p", model: "k3", capabilities: ["image_in", "video_in"],
          support_efforts: ["low", "high"], default_effort: "high" },
        { provider: "p", model: "text", capabilities: [] },
      ],
      "k3",
    )
    expect(models).toEqual([
      { id: "k2", label: "K2" },
      { id: "k3", label: "k3", efforts: ["low", "high"], defaultEffort: "high",
        inputModalities: ["text", "image"], isDefault: true },
      { id: "text", label: "text", inputModalities: ["text"] },
    ])
  })

  it("历史缺句柄或 cwd 就不列", () => {
    const base = { title: "", busy: false, agent_config: {}, usage: undefined }
    expect(
      toHistory([
        { ...base, id: "s1", last_prompt: "第一句\n第二句", updated_at: "2026-08-20T00:00:00Z", metadata: { cwd: "/w" } },
        { ...base, id: "", metadata: { cwd: "/w" } },
      ]),
    ).toEqual([{ handle: "s1", title: "第一句", cwd: "/w", updatedAt: 1787184000000 }])
  })

  it("既没标题也没首句的那条，按界面语言写「没有标题」", () => {
    const row = { id: "s2", title: "", busy: false, agent_config: {}, usage: undefined, metadata: { cwd: "/w" } }
    expect(toHistory([row])[0]?.title).toBe("（没有标题）")
    expect(toHistory([row], "en")[0]?.title).toBe("(untitled)")
  })

  it("账号周期换成协议使用的分钟和百分比", () => {
    expect(
      toLimits({
        kind: "ok",
        summary: { window: { duration: 1, unit: "week" }, used: 25, limit: 100, reset_at: "later" },
        limits: [{ window: { duration: 5, unit: "hour" }, used: 1, limit: 4 }],
      }),
    ).toEqual({
      primary: { usedPercent: 25, windowDurationMins: 10080, resetsAt: "later" },
      secondary: { usedPercent: 25, windowDurationMins: 300 },
    })
    expect(
      toLimits({
        kind: "ok",
        summary: { window: { duration: 2, unit: "day" }, used: 1, limit: 2 },
        limits: [{ window: { duration: 30, unit: "minute" }, used: 0, limit: 1 }],
      }),
    ).toEqual({
      primary: { usedPercent: 50, windowDurationMins: 2880 },
      secondary: { usedPercent: 0, windowDurationMins: 30 },
    })
  })
})
