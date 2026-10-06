import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {}, dialog: {} }))

const { lockHolderAlive, planLegacyMove } = await import("./legacy-data-dir.js")

const NEW = "/Lib/Switchback"
const OLD = "/Lib/omni"

describe("改名后要不要搬旧数据目录", () => {
  // on：目录在、里面有东西；empty：目录在、但是空的（Electron 启动时先建好的那种）
  const cases: readonly [string, { current?: string; on: readonly string[]; empty?: readonly string[]; running?: boolean }, string][] = [
    ["只有旧目录：搬", { on: [OLD] }, "move"],
    ["新目录是 Electron 先建的空目录：照样搬", { on: [OLD], empty: [NEW] }, "move"],
    ["只有旧目录、旧应用还开着：拦", { on: [OLD], empty: [NEW], running: true }, "blocked"],
    ["新目录里已经有东西：不动", { on: [OLD, NEW] }, "none"],
    ["都没有（全新安装）：不动", { on: [], empty: [NEW] }, "none"],
    ["数据目录被指到别处（冒烟测试）：不动", { current: "/tmp/smoke", on: [OLD] }, "none"],
  ]
  for (const [name, c, expected] of cases) {
    it(name, () => {
      const plan = planLegacyMove({
        current: c.current ?? NEW,
        defaultDir: NEW,
        legacy: OLD,
        list: (path) => (c.on.includes(path) ? ["threads"] : c.empty?.includes(path) === true ? [] : undefined),
        legacyRunning: () => c.running === true,
      })
      expect(plan).toBe(expected)
    })
  }
})

describe("旧应用还在不在跑：看它的单例锁", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-lock-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("没有锁：没在跑", () => {
    expect(lockHolderAlive(dir, () => true)).toBe(false)
  })

  it("锁指向的 pid 活着才算在跑", () => {
    symlinkSync("host.example-4242", join(dir, "SingletonLock"))
    expect(lockHolderAlive(dir, (pid) => pid === 4242)).toBe(true)
    expect(lockHolderAlive(dir, () => false)).toBe(false)
  })
})
