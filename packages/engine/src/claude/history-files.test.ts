import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { findSessionFile, recentSessionFiles } from "./history-files.js"

const dirs: string[] = []
const OLD = "11111111-1111-4111-8111-111111111111"
const NEW = "22222222-2222-4222-8222-222222222222"

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Claude 会话文件枚举", () => {
  it("只收非空 UUID 会话，跨项目按 mtime 排序", async () => {
    const home = await mkdtemp(join(tmpdir(), "omni-claude-home-"))
    dirs.push(home)
    const a = join(home, ".claude", "projects", "a")
    const b = join(home, ".claude", "projects", "b")
    await Promise.all([mkdir(a, { recursive: true }), mkdir(b, { recursive: true })])
    const oldPath = join(a, `${OLD}.jsonl`)
    const newPath = join(b, `${NEW}.jsonl`)
    await Promise.all([
      writeFile(oldPath, "old"), writeFile(newPath, "new"),
      writeFile(join(a, "agent-deadbeef.jsonl"), "child"),
      writeFile(join(a, "33333333-3333-4333-8333-333333333333.jsonl"), ""),
    ])
    await Promise.all([utimes(oldPath, 1, 1), utimes(newPath, 2, 2)])
    expect((await recentSessionFiles(home)).map((file) => file.id)).toEqual([NEW, OLD])
    await expect(findSessionFile(home, OLD)).resolves.toBe(oldPath)
  })

  it("目录缺失和非 UUID 句柄都安静返回空", async () => {
    const home = await mkdtemp(join(tmpdir(), "omni-claude-empty-"))
    dirs.push(home)
    await expect(recentSessionFiles(home)).resolves.toEqual([])
    await expect(findSessionFile(home, "agent-deadbeef")).resolves.toBeUndefined()
  })
})
