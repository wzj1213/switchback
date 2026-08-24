import { describe, expect, it } from "vitest"
import type { Probe } from "../probe.js"
import { createDshDriver, dshProfileOf, probeDshAcp } from "./dsh.js"

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
        state: "unavailable",
        text: "MODULE_NOT_FOUND",
      },
      {
        name: "入口就绪",
        base: found,
        profile: { ready: true },
        state: "ok",
        text: "`acp` profile 可握手",
      },
    ] as const
    for (const item of cases) {
      const result = await probeDshAcp(
        "dsh",
        "acp",
        async () => item.base,
        async () => item.profile,
      )
      expect(result, item.name).toMatchObject({ state: item.state })
      expect(result.detail, item.name).toContain(item.text)
    }
  })

  it("内置身份固定为 dsh，并使用同一份 profile 探测", async () => {
    const seen: string[] = []
    const selected = { profile: "team" }
    const driver = createDshDriver({
      command: "/opt/dsh",
      profile: () => selected.profile,
      commandProbe: async (command) => {
        seen.push(command)
        return { ...found, path: command }
      },
      profileCheck: async (command, profile) => {
        seen.push(`${command}:${profile}`)
        return { ready: true }
      },
    })
    expect(driver.id).toBe("dsh")
    await expect(driver.probe?.()).resolves.toMatchObject({ state: "ok" })
    expect(seen).toEqual(["/opt/dsh", "/opt/dsh:team"])
  })

  it("续跑保存的 profile 优先于当前默认，非法名称在 spawn 前拒绝", () => {
    expect(dshProfileOf("old", () => "new")).toBe("old")
    expect(dshProfileOf(undefined, () => "new")).toBe("new")
    expect(dshProfileOf(undefined)).toBe("acp")
    for (const bad of ["", ".", "..", "node_modules", "a/b", "a\\b"]) {
      expect(() => dshProfileOf(bad), bad).toThrow("profile 名称无效")
    }
  })
})
