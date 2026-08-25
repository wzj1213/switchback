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

  it("DSH 模型清单只取当前 profile，旧记录缺 profile 时归到 acp", () => {
    const model = (id: string): readonly ModelOption[] => [{ id, label: id }]
    const thread = (id: string, profile?: string): Thread => ({
      id, title: id, cwd: "/w", engine: "dsh", trust: "auto-edit", status: "idle",
      createdAt: 0, updatedAt: id === "team" ? 2 : 1, engineHistory: ["dsh"],
      ...(profile === undefined ? {} : { engineProfile: profile }),
    })
    const state = {
      order: ["legacy", "team"],
      threads: { legacy: thread("legacy"), team: thread("team", "team") },
      models: { legacy: { dsh: model("deepseek") }, team: { dsh: model("custom") } },
    }
    expect(engineModelCatalogs(state, "team")).toEqual({ dsh: model("custom") })
    expect(engineModelCatalogs(state, "acp")).toEqual({ dsh: model("deepseek") })
  })

  it("会话切到别家后仍按最近的 DSH 引擎段识别模型 profile", () => {
    const models: readonly ModelOption[] = [{ id: "team-model", label: "Team" }]
    const thread: Thread = {
      id: "switched", title: "已接力", cwd: "/w", engine: "codex", trust: "auto-edit",
      status: "idle", createdAt: 0, updatedAt: 2, engineHistory: ["dsh", "codex"],
      segments: [
        { engine: "dsh", profile: "team", handle: "dsh-1", startedAt: 1 },
        { engine: "codex", handle: "codex-1", startedAt: 2 },
      ],
    }
    const state = {
      order: ["switched"],
      threads: { switched: thread },
      models: { switched: { dsh: models } },
    }
    expect(engineModelCatalogs(state, "team")).toEqual({ dsh: models })
    expect(engineModelCatalogs(state, "acp")).toEqual({})
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
    const items = engineSettingItems([
      { id: "codex", label: "Codex", state: "missing" },
      { id: "dsh", label: "DSH", profile: "acp", state: "unavailable", detail: "profile 无 ACP" },
    ])
    const dsh = items.find((item) => item.id === "dsh")
    const codex = items.find((item) => item.id === "codex")
    expect(
      dsh === undefined ? undefined : engineSettingState(dsh, { dsh: { profile: "acp", confirmedProfiles: [] }, disabledEngines: [] }),
    ).toMatchObject({
      label: "未接入",
      tone: "muted",
    })
    expect(
      codex === undefined ? undefined : engineSettingState(codex, { dsh: { profile: "acp", confirmedProfiles: [] }, disabledEngines: [] }),
    ).toMatchObject({
      label: "未安装",
      tone: "warn",
    })
    expect(
      dsh === undefined
        ? undefined
        : engineSettingState(dsh, { dsh: { profile: "acp", confirmedProfiles: ["acp"] }, disabledEngines: [] }),
    ).toMatchObject({ label: "配置不可用", hint: "profile 无 ACP", tone: "warn" })
    expect(
      dsh === undefined
        ? undefined
        : engineSettingState(dsh, { dsh: { profile: "team", confirmedProfiles: ["team"] }, disabledEngines: [] }),
    ).toMatchObject({ label: "等待探测", hint: "正在探测 `team` profile。", tone: "muted" })
  })

  // 用户自己关的排在探测结论前面：一家被关掉的引擎连探测都不起，
  // 那时候还报「未安装」或者「可用」，说的都是一件 omni 此刻根本没去问过的事
  it("关掉的那家不再报探测结论，只说是你关的", () => {
    const [codex] = engineSettingItems([{ id: "codex", label: "Codex", state: "ok" }]).filter(
      (item) => item.id === "codex",
    )
    const off = { dsh: { profile: "acp", confirmedProfiles: [] }, disabledEngines: ["codex"] }
    expect(codex === undefined ? undefined : engineSettingState(codex, off)).toMatchObject({
      label: "已关掉",
      tone: "muted",
    })
  })

  it("确认过的 DSH 被关掉时也只说是你关的", () => {
    const [dsh] = engineSettingItems([
      { id: "dsh", label: "DSH", profile: "acp", state: "ok" },
    ]).filter((item) => item.id === "dsh")
    const off = { dsh: { profile: "acp", confirmedProfiles: ["acp"] }, disabledEngines: ["dsh"] }
    expect(dsh === undefined ? undefined : engineSettingState(dsh, off)).toMatchObject({
      label: "已关掉",
    })
  })
})
