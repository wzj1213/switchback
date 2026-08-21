import { describe, expect, it } from "vitest"
import type { Probe } from "../probe.js"
import { createDshDriver, probeDshAcp } from "./dsh.js"

const found: Probe = { state: "ok", detail: "/bin/dsh — 0.1.0-rc.6", path: "/bin/dsh" }

describe("DSH ACP 入口", () => {
  it("区分命令缺失、profile 未就绪与可以启动", async () => {
    const cases = [
      {
        name: "命令缺失",
        base: { state: "missing", detail: "dsh 不在 PATH" } satisfies Probe,
        profile: { ready: true },
        state: "missing",
        text: "PATH",
      },
      {
        name: "profile 未就绪",
        base: found,
        profile: { ready: false, detail: "MODULE_NOT_FOUND: dsh-session rc.8" },
        state: "missing",
        text: "MODULE_NOT_FOUND",
      },
      {
        name: "入口就绪",
        base: found,
        profile: { ready: true },
        state: "ok",
        text: "ACP profile 可握手",
      },
    ] as const
    for (const item of cases) {
      const result = await probeDshAcp(
        "dsh",
        async () => item.base,
        async () => item.profile,
      )
      expect(result, item.name).toMatchObject({ state: item.state })
      expect(result.detail, item.name).toContain(item.text)
    }
  })

  it("内置身份固定为 dsh，并使用同一份 profile 探测", async () => {
    const seen: string[] = []
    const driver = createDshDriver({
      command: "/opt/dsh",
      commandProbe: async (command) => {
        seen.push(command)
        return { ...found, path: command }
      },
      profileCheck: async (command) => {
        seen.push(command)
        return { ready: true }
      },
    })
    expect(driver.id).toBe("dsh")
    await expect(driver.probe?.()).resolves.toMatchObject({ state: "ok" })
    expect(seen).toEqual(["/opt/dsh", "/opt/dsh"])
  })
})
