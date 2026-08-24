import { describe, expect, it } from "vitest"
import type { EngineInfo } from "@omni/protocol"
import { nextEngine, withThreadEngines } from "./engines.js"

const engine = (id: string, state: EngineInfo["state"] = "ok"): EngineInfo => ({
  id,
  label: id,
  state,
})

describe("下一家引擎", () => {
  it("一键分叉跳过未安装和配置不可用的入口", () => {
    const engines = [
      engine("claude"),
      engine("kimi", "missing"),
      engine("dsh", "unavailable"),
      engine("codex"),
    ]
    expect(nextEngine(engines, "claude")?.id).toBe("codex")
  })
})

describe("保留当前会话引擎", () => {
  it("新建清单隐藏 DSH 后，当前旧会话仍保留原 profile 与展示名", () => {
    const engines = [{ id: "codex", label: "Codex", state: "ok" as const }]
    expect(withThreadEngines(engines, [{ engine: "dsh", engineProfile: "old" }])).toEqual([
      ...engines,
      { id: "dsh", label: "DSH", state: "unknown", profile: "old" },
    ])
  })

  it("已有项不复制，同一家只补一次", () => {
    const engines = [{ id: "dsh", label: "DSH", state: "ok" as const }]
    expect(withThreadEngines(engines, [{ engine: "dsh" }])).toBe(engines)
    expect(withThreadEngines([], [{ engine: "custom" }, { engine: "custom" }])).toHaveLength(1)
  })
})
