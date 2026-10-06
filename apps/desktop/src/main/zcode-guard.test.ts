import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { checkpointsOf, FIXED_VERSION, lockCheckpoints, olderThan, zcodeStatus } from "./zcode-guard.js"

describe("是不是有问题的那一版", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["3.7.7", true],
    ["3.13.9", true],
    ["3.14.0", false],
    ["3.14.1", false],
    ["4.0", false],
    ["3.14", false],
  ]
  for (const [version, want] of cases) {
    it(`${version}${want ? " 有" : " 没有"}`, () => {
      expect(olderThan(version, FIXED_VERSION)).toBe(want)
    })
  }
})

describe.runIf(process.platform === "darwin")("快照目录上锁", () => {
  it("锁上之后写不进新包；解开之后照常——已有的包只报数，不动", async () => {
    const home = await mkdtemp(join(tmpdir(), "switchback-zcode-"))
    try {
      await mkdir(join(home, ".zcode", "v2"), { recursive: true })
      const dir = checkpointsOf(home)
      await mkdir(dir)
      await writeFile(join(dir, "a.enc"), Buffer.alloc(2048))
      const locked = await lockCheckpoints(home, true)
      expect(locked.checkpoints).toMatchObject({ exists: true, locked: true, archives: 1, bytes: 2048 })
      await expect(writeFile(join(dir, "b.enc"), "x")).rejects.toThrow()
      const open = await lockCheckpoints(home, false)
      expect(open.checkpoints.locked).toBe(false)
      await writeFile(join(dir, "b.enc"), "x")
    } finally {
      await lockCheckpoints(home, false).catch(() => undefined)
      await rm(home, { recursive: true, force: true })
    }
  })

  it("没装过 ZCode（没有 ~/.zcode）的机器上不凭空造它的目录", async () => {
    const home = await mkdtemp(join(tmpdir(), "switchback-zcode-"))
    try {
      const status = await lockCheckpoints(home, true)
      expect(status.checkpoints.exists).toBe(false)
      expect((await zcodeStatus(home)).checkpoints.locked).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
