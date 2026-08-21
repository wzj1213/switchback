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
      (id) => id !== "dsh" || shown.dsh,
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
      () => shown.dsh,
    )

    const pending = catalog()
    shown.dsh = false
    gate.finish?.()
    await expect(pending).resolves.toEqual([])
  })
})
