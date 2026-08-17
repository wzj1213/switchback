import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }))

const { worksiteInfo, parseStatus } = await import("./worksite.js")

/**
 * 真的建一个 git 仓库来测。
 *
 * mock 掉 `git` 之后这个测试就只剩「我写的 if 分支还在」了，而这里要验的
 * 恰恰是**和真实 git 的交互**——比如「新建的空仓库有没有 HEAD」
 * 这种只有真跑才知道的事。
 */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "omni-git-"))
  execFileSync("git", ["init", "-q", "-b", "试验分支"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  writeFileSync(join(dir, "a.txt"), "1\n")
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
  return dir
}

describe("工作区状态", () => {
  it("报出当前分支——**「引擎会改到哪个分支」以前界面上一个字都没有**", async () => {
    expect((await worksiteInfo(repo())).branch).toBe("试验分支")
  })

  it("干净的仓库 dirty 为 false", async () => {
    expect((await worksiteInfo(repo())).dirty).toBe(false)
  })

  it("有改动就是 dirty——agent 在别人的改动上面动手，出问题时两拨改动混在一个 diff 里", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "2\n")
    expect((await worksiteInfo(dir)).dirty).toBe(true)
  })

  it("未跟踪的文件也算脏", async () => {
    const dir = repo()
    writeFileSync(join(dir, "新文件.txt"), "x\n")
    expect((await worksiteInfo(dir)).dirty).toBe(true)
  })

  it("**不是 git 仓库不算错误**，只是没有分支可显示", async () => {
    expect(await worksiteInfo(mkdtempSync(join(tmpdir(), "omni-plain-")))).toEqual({})
  })

  it("目录不存在也不抛——界面不该因为一个失效的路径炸掉", async () => {
    expect(await worksiteInfo("/根本没有这个目录/xyz")).toEqual({})
  })
})

/**
 * `git status --porcelain -z` 的解析。
 *
 * **用 `-z` 而不是默认输出**：默认那套会给含空格或非 ASCII 的路径加引号并转义
 * （`"a b/\344\270\255.md"`），自己解那套引号是纯粹的自找麻烦。
 */
describe("工作区里变了哪些文件", () => {
  it("普通的几条", () => {
    expect(parseStatus(" M src/a.ts\0?? new.md\0")).toEqual(["src/a.ts", "new.md"])
  })

  it("**含空格和中文的路径原样出来**——这正是不用默认输出的理由", () => {
    expect(parseStatus(" M 我的 笔记/一 二.md\0")).toEqual(["我的 笔记/一 二.md"])
  })

  it("**重命名那条的旧名单独占一段**，不能当成另一个改动", () => {
    expect(parseStatus("R  新.ts\0旧.ts\0 M other.ts\0")).toEqual(["新.ts", "other.ts"])
  })

  it("干净的工作区就是空的", () => {
    expect(parseStatus("")).toEqual([])
  })

  it("末尾没有分隔符也不崩（不同 git 版本给的不完全一样）", () => {
    expect(parseStatus(" M a.ts")).toEqual(["a.ts"])
  })
})
