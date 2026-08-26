import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { ReviewScope } from "../shared/review.js"
import { workPatch, workReview } from "./workdiff.js"

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: ENV }).trim()
}

function fixture(base: string): string {
  const repo = join(base, "repo")
  mkdirSync(repo)
  git(repo, "init", "-q")
  for (const file of ["a.txt", "b.txt", "last.txt"]) writeFileSync(join(repo, file), "head\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "init")
  const baseCommit = git(repo, "rev-parse", "HEAD")
  writeFileSync(join(repo, "last.txt"), "last commit\n")
  git(repo, "add", "last.txt")
  git(repo, "commit", "-qm", "last")
  git(repo, "update-ref", "refs/remotes/origin/main", baseCommit)
  writeFileSync(join(repo, "a.txt"), "unstaged\n")
  writeFileSync(join(repo, "b.txt"), "staged\n")
  writeFileSync(join(repo, "fresh.txt"), "fresh\n")
  git(repo, "add", "b.txt")
  return repo
}

describe("Git 审核范围", () => {
  it("每个选择只返回自己声明的 Git 范围", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-review-scopes-"))
    try {
      const repo = fixture(base)
      const cases: readonly [ReviewScope, readonly string[]][] = [
        ["uncommitted", ["a.txt", "b.txt", "fresh.txt"]],
        ["unstaged", ["a.txt", "fresh.txt"]],
        ["staged", ["b.txt"]],
        ["last-commit", ["last.txt"]],
        ["branch", ["a.txt", "b.txt", "last.txt"]],
      ]
      for (const [scope, expected] of cases) {
        const review = await workReview(repo, { scope })
        expect(review?.files.map((file) => file.rel).sort(), scope).toEqual(expected)
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("补丁与清单使用同一个范围", async () => {
    const base = mkdtempSync(join(tmpdir(), "omni-review-scope-patch-"))
    try {
      const repo = fixture(base)
      const cases: readonly [ReviewScope, string, string][] = [
        ["unstaged", "a.txt", "+unstaged"],
        ["staged", "b.txt", "+staged"],
        ["last-commit", "last.txt", "+last commit"],
        ["branch", "last.txt", "+last commit"],
      ]
      for (const [scope, file, expected] of cases) {
        expect((await workPatch(repo, file, 3, { scope })).patch, scope).toContain(expected)
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
