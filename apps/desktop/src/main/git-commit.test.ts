import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { gitCommit, gitStage, gitState, gitUndo, parseStatus } from "./git-commit.js"

/** 真仓库。本地配置盖掉全局的签名与钩子：这台机器上的全局设置不该让测试卡住或变红。 */
function repo(options: { commit?: boolean } = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "switchback-git-")))
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" })
  }
  git("init", "-q", "-b", "main")
  git("config", "user.name", "switchback-test")
  git("config", "user.email", "switchback-test@example.invalid")
  git("config", "commit.gpgsign", "false")
  git("config", "core.hooksPath", join(dir, ".no-hooks"))
  if (options.commit !== false) {
    writeFileSync(join(dir, "a.txt"), "a\n")
    writeFileSync(join(dir, "b.txt"), "b\n")
    git("add", "-A")
    git("commit", "-q", "-m", "init")
  }
  return dir
}

const log = (dir: string): string => execFileSync("git", ["log", "--format=%s", "-n", "3"], { cwd: dir, encoding: "utf8" })

describe("parseStatus（porcelain v2 -z）", () => {
  it("分支、上游、领先落后，以及各类计数；改名的旧名那段要跳过", () => {
    const raw = [
      "# branch.oid 1234567", "# branch.head feature/x", "# branch.upstream origin/feature/x", "# branch.ab +2 -1",
      "1 M. N... 100644 100644 100644 aaa bbb staged.txt",
      "1 .M N... 100644 100644 100644 aaa bbb dirty.txt",
      "1 MM N... 100644 100644 100644 aaa bbb both.txt",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.txt", "old.txt",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc clash.txt",
      "? fresh.txt",
      "",
    ].join("\0")
    expect(parseStatus(raw)).toEqual({
      branch: "feature/x", upstream: "origin/feature/x", ahead: 2, behind: 1,
      staged: 3, unstaged: 2, untracked: 1, conflicted: 1,
    })
  })

  it("游离 HEAD", () => {
    expect(parseStatus("# branch.oid abc\0# branch.head (detached)\0")).toMatchObject({ detached: true, staged: 0 })
  })
})

describe("在真仓库里暂存与提交", () => {
  it("状态：不在仓库里就说不在", async () => {
    const plain = mkdtempSync(join(tmpdir(), "switchback-plain-"))
    expect(await gitState(plain)).toMatchObject({ repo: false })
  })

  it("全部提交：连新文件一起，提交完工作区干净", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    writeFileSync(join(dir, "c.txt"), "new\n")
    expect(await gitState(dir)).toMatchObject({ repo: true, root: dir, branch: "main", staged: 0, unstaged: 1, untracked: 1 })
    const done = await gitCommit(dir, { message: "改 a 并加 c\n\n正文第二段", all: true })
    expect(done).toMatchObject({ ok: true, subject: "改 a 并加 c" })
    expect(done.sha).toMatch(/^[0-9a-f]{7,}$/u)
    expect(log(dir).split("\n")[0]).toBe("改 a 并加 c")
    expect(await gitState(dir)).toMatchObject({ staged: 0, unstaged: 0, untracked: 0 })
  })

  it("只提交已暂存的：没暂存的那份留在工作区", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    writeFileSync(join(dir, "b.txt"), "b2\n")
    expect(await gitStage(dir, { rel: "a.txt", stage: true })).toEqual({ ok: true })
    expect(await gitCommit(dir, { message: "只改 a", all: false })).toMatchObject({ ok: true })
    expect(await gitState(dir)).toMatchObject({ staged: 0, unstaged: 1 })
  })

  it("暂存区空着又没选全部：不提交，说清下一步", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    const done = await gitCommit(dir, { message: "x", all: false })
    expect(done.ok).toBe(false)
    expect(done.error).toBe("nothing-staged")
    expect(log(dir).trim()).toBe("init")
  })

  it("空说明、没有改动：都不提交", async () => {
    const dir = repo()
    expect((await gitCommit(dir, { message: "  \n", all: true })).error).toBe("empty-message")
    expect((await gitCommit(dir, { message: "x", all: true })).error).toBe("nothing")
  })

  it("钩子拦下来：原文带回来", async () => {
    const dir = repo()
    mkdirSync(join(dir, ".no-hooks"), { recursive: true })
    writeFileSync(join(dir, ".no-hooks", "pre-commit"), "#!/bin/sh\necho 'lint 没过：a.txt 第 1 行' >&2\nexit 1\n", { mode: 0o755 })
    writeFileSync(join(dir, "a.txt"), "a2\n")
    const done = await gitCommit(dir, { message: "x", all: true })
    expect(done.ok).toBe(false)
    expect(done.output).toContain("lint 没过")
  })

  it("取消暂存；还没有任何提交的仓库也能取消（不动工作区里的文件）", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    await gitStage(dir, { rel: "a.txt", stage: true })
    expect(await gitStage(dir, { rel: "a.txt", stage: false })).toEqual({ ok: true })
    expect(await gitState(dir)).toMatchObject({ staged: 0, unstaged: 1 })
    const fresh = repo({ commit: false })
    writeFileSync(join(fresh, "n.txt"), "n\n")
    await gitStage(fresh, { rel: "n.txt", stage: true })
    expect(await gitState(fresh)).toMatchObject({ staged: 1 })
    expect(await gitStage(fresh, { rel: "n.txt", stage: false })).toEqual({ ok: true })
    expect(await gitState(fresh)).toMatchObject({ staged: 0, untracked: 1 })
  })

  it("路径必须在仓库里，按字面处理（不当通配）", async () => {
    const dir = repo()
    expect((await gitStage(dir, { rel: "../x", stage: true })).error).toBe("outside")
    expect((await gitStage(dir, { rel: "/etc/hosts", stage: true })).error).toBe("outside")
    writeFileSync(join(dir, "a.txt"), "a2\n")
    writeFileSync(join(dir, "b.txt"), "b2\n")
    await gitStage(dir, { rel: "*.txt", stage: true })
    expect(await gitState(dir)).toMatchObject({ staged: 0, unstaged: 2 })
  })
})

describe("撤销刚才那次提交", () => {
  const head = (dir: string): string => execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim()

  it("HEAD 仍是它：退回去，改动回到暂存区，工作区不动", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    const done = await gitCommit(dir, { message: "改 a", all: true })
    expect(done.full).toBe(head(dir))
    expect(await gitUndo(dir, { full: done.full ?? "" })).toEqual({ ok: true, undone: true })
    expect(log(dir).trim()).toBe("init")
    expect(await gitState(dir)).toMatchObject({ staged: 1, unstaged: 0 })
  })

  it("之后又提交过：不撤（会连别人的一起退掉）", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    const first = await gitCommit(dir, { message: "一", all: true })
    writeFileSync(join(dir, "b.txt"), "b2\n")
    await gitCommit(dir, { message: "二", all: true })
    const refused = await gitUndo(dir, { full: first.full ?? "" })
    expect(refused.ok).toBe(false)
    expect(refused.error).toBe("head-moved")
    expect(log(dir).split("\n")[0]).toBe("二")
  })

  it("已经在远程分支里了：不撤", async () => {
    const dir = repo()
    writeFileSync(join(dir, "a.txt"), "a2\n")
    const done = await gitCommit(dir, { message: "推过的", all: true })
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: dir })
    const refused = await gitUndo(dir, { full: done.full ?? "" })
    expect(refused).toMatchObject({ error: "pushed", remote: "origin/main" })
    expect(log(dir).split("\n")[0]).toBe("推过的")
  })

  it("仓库的第一个提交也能撤：分支引用删掉，文件留在暂存区", async () => {
    const dir = repo({ commit: false })
    writeFileSync(join(dir, "n.txt"), "n\n")
    const done = await gitCommit(dir, { message: "第一个", all: true })
    expect(await gitUndo(dir, { full: done.full ?? "" })).toEqual({ ok: true, undone: true })
    expect(await gitState(dir)).toMatchObject({ staged: 1 })
  })
})
