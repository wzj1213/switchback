import { describe, expect, it } from "vitest"
import type { EngineInfo, ModelOption, Thread } from "@omni/protocol"
import {
  engineModelCatalogs,
  engineSettingState,
  engineSettingItems,
  initialEngine,
  withEnginePick,
} from "./engine-settings-model.js"

describe("引擎设置页的数据", () => {
  it("未接入 DSH 时仍画全五家，第三方引擎跟在后面", () => {
    const catalog: EngineInfo[] = [
      { id: "claude", label: "Claude", state: "ok" },
      { id: "acp:zcode", label: "ZCode", state: "unknown" },
    ]
    const items = engineSettingItems(catalog)
    expect(items.map((item) => item.id)).toEqual([
      "claude",
      "codex",
      "kimi",
      "grok",
      "dsh",
      "acp:zcode",
    ])
    expect(items[0]?.state).toBe("ok")
    expect(items.at(-1)?.builtin).toBe(false)
  })

  it("模型清单按会话活跃时间取最近的非空一份", () => {
    const model = (id: string): readonly ModelOption[] => [{ id, label: id }]
    const thread = (id: string, updatedAt: number): Thread => ({
      id,
      title: id,
      cwd: "/w",
      engine: "codex",
      trust: "auto-edit",
      status: "idle",
      createdAt: 0,
      updatedAt,
      engineHistory: ["codex"],
    })
    const state = {
      order: ["old", "empty", "new"],
      threads: { old: thread("old", 1), empty: thread("empty", 3), new: thread("new", 2) },
      models: {
        old: { codex: model("old") },
        empty: { codex: [] },
        new: { codex: model("new"), kimi: model("k3") },
      },
    }
    expect(engineModelCatalogs(state)).toEqual({ codex: model("new"), kimi: model("k3") })
  })

  it("改模型只改这一家，不篡改上次使用的引擎", () => {
    const last = {
      engine: "codex",
      byEngine: { codex: { model: "gpt" }, claude: { model: "opus" } },
    }
    expect(withEnginePick(last, "claude", { model: "sonnet", effort: "high" })).toEqual({
      engine: "codex",
      byEngine: { codex: { model: "gpt" }, claude: { model: "sonnet", effort: "high" } },
    })
    expect(withEnginePick(last, "claude", undefined)).toEqual({
      engine: "codex",
      byEngine: { codex: { model: "gpt" } },
    })
  })

  it("打开时按明写默认、上次、第一家的顺序选中", () => {
    const items = engineSettingItems([{ id: "claude", label: "Claude" }])
    expect(initialEngine(items, "grok", "codex")).toBe("grok")
    expect(initialEngine(items, "missing", "kimi")).toBe("kimi")
    expect(initialEngine(items, "missing", "also-missing")).toBe("claude")
  })

  it("DSH 未确认与探测 missing 是两种不同状态", () => {
    const items = engineSettingItems([{ id: "codex", label: "Codex", state: "missing" }])
    const dsh = items.find((item) => item.id === "dsh")
    const codex = items.find((item) => item.id === "codex")
    expect(
      dsh === undefined ? undefined : engineSettingState(dsh, { dsh: { configured: false } }),
    ).toMatchObject({
      label: "未接入",
      tone: "muted",
    })
    expect(
      codex === undefined ? undefined : engineSettingState(codex, { dsh: { configured: false } }),
    ).toMatchObject({
      label: "未安装",
      tone: "warn",
    })
  })
})
