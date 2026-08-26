import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createWorktreeBaselines } from "./worktree-baseline.js"

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV })
}

function repoAt(base: string): string {
  const repo = join(base, "repo")
  mkdirSync(repo)
  git(repo, "init", "-q")
  return repo
}

describe("对话工作树基线", () => {
  it("每轮覆盖上一轮快照，不把更早轮次的改动混进来", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-turn-baseline-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, "one.txt"), "head\n")
      writeFileSync(join(repo, "two.txt"), "head\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "init")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.captureTurn("thread-turn", repo)
      writeFileSync(join(repo, "one.txt"), "first turn\n")
      expect((await baselines.review("thread-turn", repo, [], true))?.files.map((file) => file.rel))
        .toEqual(["one.txt"])

      await baselines.captureTurn("thread-turn", repo)
      writeFileSync(join(repo, "two.txt"), "second turn\n")
      const review = await baselines.review("thread-turn", repo, [], true)
      expect(review?.files.map((file) => file.rel)).toEqual(["two.txt"])
      expect(await baselines.patch("thread-turn", repo, "two.txt", { context: 3, turn: true })).toContain("+second turn")
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("排除开场前的脏文件，并跨多轮、暂存和提交计算最终净差异", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, "tracked.txt"), "head\n")
      writeFileSync(join(repo, "untouched.txt"), "head\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "init")
      writeFileSync(join(repo, "tracked.txt"), "before\n")
      writeFileSync(join(repo, "untouched.txt"), "already dirty\n")
      writeFileSync(join(repo, "preexisting.txt"), "before untracked\n")

      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-1", repo)
      expect((await baselines.review("thread-1", repo))?.files).toEqual([])

      writeFileSync(join(repo, "tracked.txt"), "after\nmore\n")
      writeFileSync(join(repo, "preexisting.txt"), "after untracked\n")
      writeFileSync(join(repo, "new.txt"), "new\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "during conversation")

      const review = await baselines.review("thread-1", repo)
      expect(review?.files.map((file) => file.rel).sort()).toEqual([
        "new.txt",
        "preexisting.txt",
        "tracked.txt",
      ])
      expect(review?.files.some((file) => file.rel === "untouched.txt")).toBe(false)
      expect(review?.files.find((file) => file.rel === "preexisting.txt")?.kind).toBe("update")
      const patch = await baselines.patch("thread-1", repo, "tracked.txt", { context: 3 })
      expect(patch).toContain("-before")
      expect(patch).toContain("+after")

      writeFileSync(join(repo, "tracked.txt"), "before\n")
      writeFileSync(join(repo, "preexisting.txt"), "before untracked\n")
      unlinkSync(join(repo, "new.txt"))
      expect((await baselines.review("thread-1", repo))?.files).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("无提交仓库、符号链接入口和 staged 新文件都能对齐", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-link-"))
    try {
      const repo = repoAt(base)
      const linked = join(base, "linked")
      symlinkSync(repo, linked)
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-link", linked)
      writeFileSync(join(repo, "fresh.txt"), "one\ntwo\n")
      git(repo, "add", "fresh.txt")

      const review = await baselines.review("thread-link", linked, [join(linked, "fresh.txt")])
      expect(review?.cwd).toBe(realpathSync(repo))
      expect(review?.files).toEqual([
        expect.objectContaining({ rel: "fresh.txt", added: 2, removed: 0, staged: true }),
      ])
      expect(await baselines.patch("thread-link", linked, "fresh.txt", { context: 3 })).toContain("+one")
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("开场前的暂存不冒充本轮已暂存，只有最终内容完整进 index 才标记", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-staged-before-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, "mixed.txt"), "head\n")
      git(repo, "add", "mixed.txt")
      git(repo, "commit", "-qm", "init")
      writeFileSync(join(repo, "mixed.txt"), "before staged\n")
      git(repo, "add", "mixed.txt")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-staged-before", repo)

      writeFileSync(join(repo, "mixed.txt"), "conversation unstaged\n")
      expect((await baselines.review("thread-staged-before", repo))?.files[0]?.staged).toBeUndefined()
      git(repo, "add", "mixed.txt")
      expect((await baselines.review("thread-staged-before", repo))?.files[0]?.staged).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("明确报告的 ignored 文件不冒充零改动，force-add 后也能进入当前树", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-ignore-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, ".gitignore"), "ignored.txt\n")
      git(repo, "add", ".gitignore")
      git(repo, "commit", "-qm", "ignore")
      const target = join(repo, "ignored.txt")
      writeFileSync(target, "before\n")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-ignore", repo)

      writeFileSync(target, "after\n")
      const hidden = await baselines.review("thread-ignore", repo, [target])
      expect(hidden?.files).toEqual([])
      expect(hidden?.ignored).toEqual(["ignored.txt"])

      git(repo, "add", "-f", "ignored.txt")
      const staged = await baselines.review("thread-ignore", repo, [target])
      expect(staged?.files).toEqual([
        expect.objectContaining({ rel: "ignored.txt", staged: true }),
      ])
      expect(staged?.ignored).toEqual(["ignored.txt"])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("开场树已经 force-add 的 ignored 文件仍采用真实树差异", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-tracked-ignore-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, ".gitignore"), "ignored.txt\n")
      writeFileSync(join(repo, "ignored.txt"), "before\n")
      git(repo, "add", ".gitignore")
      git(repo, "add", "-f", "ignored.txt")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-tracked-ignore", repo)

      writeFileSync(join(repo, "ignored.txt"), "after\n")
      const review = await baselines.review("thread-tracked-ignore", repo, [join(repo, "ignored.txt")])
      expect(review?.ignored).toBeUndefined()
      expect(review?.files).toEqual([
        expect.objectContaining({ rel: "ignored.txt", added: 1, removed: 1 }),
      ])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("cwd 在子目录时，仓库其他目录的 /tmp 绝对别名仍能进入 ignored 核实", async () => {
    const base = mkdtempSync("/tmp/omni-baseline-root-alias-")
    try {
      const repo = repoAt(base)
      const sub = join(repo, "sub")
      mkdirSync(sub)
      writeFileSync(join(repo, ".gitignore"), "ignored.txt\n")
      git(repo, "add", ".gitignore")
      git(repo, "commit", "-qm", "ignore")
      const target = join(repo, "ignored.txt")
      writeFileSync(target, "before\n")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-root-alias", sub)

      writeFileSync(target, "after\n")
      const review = await baselines.review("thread-root-alias", sub, [target])
      expect(review?.ignored).toEqual(["ignored.txt"])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("500 条上限之外仍保留引擎明确报告的目标", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-many-"))
    try {
      const repo = repoAt(base)
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-many", repo)
      for (let index = 0; index < 501; index += 1) {
        writeFileSync(join(repo, `a-${String(index).padStart(3, "0")}.txt`), "x\n")
      }
      const target = join(repo, "z-target.txt")
      writeFileSync(target, "target\n")

      const review = await baselines.review("thread-many", repo, [target])
      expect(review?.files.some((file) => file.rel === "z-target.txt")).toBe(true)
      expect(review?.more).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("改名文件的按需补丁保留旧路径，不把新路径冒充整文件新增", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-rename-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, "old.txt"), "one\ntwo\n")
      git(repo, "add", "old.txt")
      git(repo, "commit", "-qm", "init")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-rename", repo)
      git(repo, "mv", "old.txt", "new.txt")
      writeFileSync(join(repo, "new.txt"), "one\ntwo\nthree\n")

      const patch = await baselines.patch("thread-rename", repo, "new.txt", { context: 3 })
      expect(patch).toContain("rename from old.txt")
      expect(patch).toContain("+three")
      expect(patch).not.toContain("+one")
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("按需补丁把 pathspec 魔法前缀当成普通文件名", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-literal-"))
    try {
      const repo = repoAt(base)
      const magic = ":(glob)*.txt"
      writeFileSync(join(repo, magic), "magic before\n")
      writeFileSync(join(repo, "other.txt"), "other before\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "init")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-literal", repo)
      writeFileSync(join(repo, magic), "magic after\n")
      writeFileSync(join(repo, "other.txt"), "other after\n")

      const patch = await baselines.patch("thread-literal", repo, magic, { context: 3 })
      expect(patch).toContain("magic after")
      expect(patch).not.toContain("other after")
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("首次取样与删除同拍发生时，迟到取样不会把基线目录建回来", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-remove-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, "a.txt"), "a\n")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      const capture = baselines.ensure("thread-remove", repo)
      await Promise.all([capture, baselines.remove("thread-remove")])
      expect(await baselines.review("thread-remove", repo)).toBeUndefined()
      await baselines.ensure("thread-remove", repo)
      expect(await baselines.review("thread-remove", repo)).toBeUndefined()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("真实 Git 状态读取失败时不把缺失的暂存信息冒充成成功结果", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-baseline-broken-status-"))
    try {
      const repo = repoAt(base)
      writeFileSync(join(repo, "tracked.txt"), "before\n")
      git(repo, "add", "tracked.txt")
      git(repo, "commit", "-qm", "init")
      const baselines = createWorktreeBaselines(join(base, "cache"))
      await baselines.ensure("thread-broken", repo)
      writeFileSync(join(repo, "tracked.txt"), "after\n")
      writeFileSync(join(repo, ".git", "index"), "not a git index")

      await expect(baselines.review("thread-broken", repo)).rejects.toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
