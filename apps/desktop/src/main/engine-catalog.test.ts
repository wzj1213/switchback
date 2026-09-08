import { describe, expect, it } from "vitest"
import { createEngineCatalog } from "./engine-catalog.js"
import type { Logger } from "./log.js"

const log: Logger = { file: "/tmp/omni-engine-catalog.log", write: () => undefined }

describe("宿主引擎目录", () => {
  it("首屏快照不等待探测，完成后可读；失效或隐藏时撤掉旧状态", async () => {
    const shown = { value: true }
    const gate: { finish?: () => void } = {}
    const catalog = createEngineCatalog({ codex: {
      probe: () => new Promise((resolve) => {
        gate.finish = () => resolve({ state: "ok", detail: "ready" })
      }),
    } }, { codex: "Codex" }, log, { visible: () => shown.value })
    const pending = catalog()
    expect(catalog.current()).toEqual([])
    gate.finish?.()
    await pending
    expect(catalog.current()).toMatchObject([{ id: "codex", state: "ok" }])
    shown.value = false
    expect(catalog.current()).toEqual([])
    shown.value = true
    catalog.invalidate("codex")
    expect(catalog.current()).toEqual([])
  })

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

  /**
   * **这条测的是那个「装完了还显示未安装」的 bug。**
   *
   * 缓存原来只有 DSH 改 profile 那一条失效路径，于是在终端里装好一家引擎
   * 之后，界面上唯一的出路是重启 omni——codex 的安装提示原话就是
   * 「装好之后重启 omni」。不给 id 的 `invalidate()` 是那条出路。
   */
  it("不给 id 的 invalidate 让**每一家**都重探——装完一家不必重启", async () => {
    const calls = { codex: 0, kimi: 0 }
    const state = { codex: "missing" as string }
    const catalog = createEngineCatalog(
      {
        codex: {
          probe: async () => {
            calls.codex += 1
            return { state: state.codex, detail: state.codex }
          },
        },
        kimi: {
          probe: async () => {
            calls.kimi += 1
            return { state: "ok", detail: "ok" }
          },
        },
      },
      { codex: "Codex", kimi: "Kimi Code" },
      log,
    )

    expect((await catalog()).find((e) => e.id === "codex")?.state).toBe("missing")
    await catalog()
    expect(calls).toEqual({ codex: 1, kimi: 1 })

    // 用户在终端里把 codex 装上了。**不重探的话这里永远还是 missing**
    state.codex = "ok"
    expect((await catalog()).find((e) => e.id === "codex")?.state).toBe("missing")

    catalog.invalidate()
    expect((await catalog()).find((e) => e.id === "codex")?.state).toBe("ok")
    // 两家都重探了：我们并不知道用户装的是哪一家，只清一家等于自作聪明
    expect(calls).toEqual({ codex: 2, kimi: 2 })
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
