import { describe, expect, it } from "vitest"
import { createEngineCatalog } from "./engine-catalog.js"
import type { Logger } from "./log.js"

const log: Logger = { file: "/tmp/omni-engine-catalog.log", write: () => undefined }

describe("宿主引擎目录", () => {
  it("隐藏项不探测；后来显示时只探一次", async () => {
    const calls = { dsh: 0, codex: 0 }
    const shown = { dsh: false }
    const catalog = createEngineCatalog(
      {
        codex: {
          probe: async () => {
            calls.codex += 1
            return { state: "ok", detail: "ok" }
          },
        },
        dsh: {
          probe: async () => {
            calls.dsh += 1
            return { state: "ok", detail: "ok" }
          },
        },
      },
      { codex: "Codex", dsh: "DSH" },
      log,
      { visible: (id) => id !== "dsh" || shown.dsh },
    )

    expect((await catalog()).map((engine) => engine.id)).toEqual(["codex"])
    expect(calls).toEqual({ dsh: 0, codex: 1 })
    shown.dsh = true
    expect((await catalog()).map((engine) => engine.id)).toEqual(["codex", "dsh"])
    await catalog()
    expect(calls).toEqual({ dsh: 1, codex: 1 })
  })

  it("探测还没回来就关闭接入时，旧结果不能把 DSH 写回远程清单", async () => {
    const shown = { dsh: true }
    const gate: { finish?: () => void } = {}
    const catalog = createEngineCatalog(
      {
        dsh: {
          probe: () =>
            new Promise((resolve) => {
              gate.finish = () => resolve({ state: "ok", detail: "ok" })
            }),
        },
      },
      { dsh: "DSH" },
      log,
      { visible: () => shown.dsh },
    )

    const pending = catalog()
    shown.dsh = false
    gate.finish?.()
    await expect(pending).resolves.toEqual([])
  })

  it("profile 变更只让 DSH 重新探测，其他引擎仍复用缓存", async () => {
    const profile = { name: "acp" }
    const calls = { dsh: 0, codex: 0 }
    const driver = (id: keyof typeof calls) => ({ probe: async () => {
      calls[id] += 1
      return { state: "ok", detail: id === "dsh" ? profile.name : id }
    } })
    const catalog = createEngineCatalog(
      { dsh: driver("dsh"), codex: driver("codex") },
      { dsh: "DSH", codex: "Codex" },
      log,
      { profile: (id) => id === "dsh" ? profile.name : undefined },
    )
    await catalog()
    profile.name = "team"
    const switched = await catalog()
    expect(calls).toEqual({ dsh: 2, codex: 1 })
    expect(switched.find((engine) => engine.id === "dsh")?.profile).toBe("team")
    catalog.invalidate("dsh")
    await catalog()
    expect(calls).toEqual({ dsh: 3, codex: 1 })
  })

  it("旧 profile 的慢探测回包不会覆盖新 profile", async () => {
    const profile = { name: "acp" }
    const gates = new Map<string, (value: { state: string; detail: string }) => void>()
    const catalog = createEngineCatalog(
      { dsh: { probe: () => new Promise((resolve) => { gates.set(profile.name, resolve) }) } },
      { dsh: "DSH" },
      log,
      { profile: () => profile.name },
    )
    const old = catalog()
    profile.name = "team"
    const current = catalog()
    gates.get("acp")?.({ state: "ok", detail: "acp" })
    await expect(old).resolves.toEqual([])
    gates.get("team")?.({ state: "ok", detail: "team" })
    await expect(current).resolves.toMatchObject([{ id: "dsh", detail: "team", profile: "team" }])
  })

  it("同一 profile 手动重探后，上一轮慢回包也会作废", async () => {
    const gates: ((value: { state: string; detail: string }) => void)[] = []
    const catalog = createEngineCatalog(
      { dsh: { probe: () => new Promise((resolve) => gates.push(resolve)) } },
      { dsh: "DSH" },
      log,
      { profile: () => "acp" },
    )
    const old = catalog()
    catalog.invalidate("dsh")
    const current = catalog()
    gates[0]?.({ state: "ok", detail: "old" })
    await expect(old).resolves.toEqual([])
    gates[1]?.({ state: "ok", detail: "current" })
    await expect(current).resolves.toMatchObject([{ detail: "current", profile: "acp" }])
  })
})
