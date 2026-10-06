import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { reframe, repoForRel, repoSlices, spreadFrom, spreadReview } from "./workdiff-multi.js"

const run = promisify(execFile)

/**
 * 真起两个 git 仓库来测：**这一层问的就是 git 自己**（`rev-parse --show-toplevel`），
 * 打桩等于测一个假的 git，而那个假的永远不会和真的一起坏掉。
 */
/** 模块级 `let` 是禁的（AGENTS.md 反模式 2），所以这几条路径挂在一个对象上。 */
const dirs = { home: "", repoA: "", repoB: "" }

beforeAll(async () => {
  // realpath：macOS 上 mkdtemp 给的是 /var/…，而 git 吐的是 /private/var/…
  dirs.home = await realpath(await mkdtemp(join(tmpdir(), "switchback-multi-")))
  dirs.repoA = join(dirs.home, "仓库甲")
  dirs.repoB = join(dirs.home, "repo-b")
  for (const root of [dirs.repoA, dirs.repoB]) {
    await mkdir(join(root, "src"), { recursive: true })
    await writeFile(join(root, "src/index.ts"), "export const a = 1\n")
    await run("git", ["init", "-q"], { cwd: root })
    await run("git", ["config", "user.email", "t@t"], { cwd: root })
    await run("git", ["config", "user.name", "t"], { cwd: root })
    await run("git", ["add", "-A"], { cwd: root })
    await run("git", ["commit", "-qm", "init"], { cwd: root })
  }
  // 总目录自己不是仓库；两个仓库各改一行
  await writeFile(join(dirs.repoA, "src/index.ts"), "export const a = 2\n")
  await writeFile(join(dirs.repoB, "src/index.ts"), "export const a = 3\n")
})

afterAll(async () => {
  await rm(dirs.home, { recursive: true, force: true })
})

describe("总目录不是仓库、底下挂着几个仓库", () => {
  it("按文件所属的仓库分组；总目录外的、不在仓库里的都不收", async () => {
    const slices = await repoSlices(dirs.home, [
      join(dirs.repoA, "src/index.ts"),
      join(dirs.repoA, "src/other.ts"),
      join(dirs.repoB, "src/index.ts"),
      // 总目录之外：引擎读 /tmp、读技能文档是常事，不该冒出一个没打开过的仓库
      "/tmp/somewhere.md",
      // 总目录底下但不在任何仓库里
      join(dirs.home, "散着的.md"),
    ])
    expect(slices.map((s) => s.root).sort()).toEqual([dirs.repoA, dirs.repoB].sort())
    expect(slices.find((s) => s.root === dirs.repoA)?.paths).toHaveLength(2)
  })

  it("一条相对总目录的路径能找回它自己那个仓库", async () => {
    expect(await repoForRel(dirs.home, "仓库甲/src/index.ts")).toEqual({ root: dirs.repoA, rel: "src/index.ts" })
    // 逃出总目录的一律拒——不是怕注入，是不想让界面 bug 变成「读任意文件」
    expect(await repoForRel(dirs.home, "../../etc/passwd")).toBeUndefined()
    expect(await repoForRel(dirs.home, "散着的.md")).toBeUndefined()
  })

  it("`rel` 换成相对总目录：两个仓库里的同名文件在同一张清单里分得开", () => {
    const files = reframe(dirs.home, dirs.repoA, [
      { path: join(dirs.repoA, "src/index.ts"), rel: "src/index.ts", kind: "update", added: 1, removed: 1 },
    ])
    expect(files[0]?.rel).toBe("仓库甲/src/index.ts")
    // 身份仍然是绝对路径，不受影响
    expect(files[0]?.path).toBe(join(dirs.repoA, "src/index.ts"))
  })

  it("**递归回去时 `scope` 必须摘掉**——不摘每个仓库都回一张 turnMissing 的空清单", async () => {
    const seen: (string | undefined)[] = []
    const one = async (root: string, source: { wanted?: readonly string[]; scope?: string }) => {
      seen.push(source.scope)
      return { root, cwd: root, files: [] }
    }
    // 调用方（`workdiff.ts` 的 `spreadOne`）负责摘；这里验的是它确实摘了
    await spreadFrom(dirs.home, { wanted: [join(dirs.repoA, "src/index.ts")] },
      (root, slice) => one(root, { ...slice, scope: undefined }))
    expect(seen).toEqual([undefined])
  })

  it("几个仓库的清单并成一张；一个都问不出来时才算没有", async () => {
    const one = async (root: string, source: { wanted?: readonly string[] }) => ({
      root, cwd: root,
      files: (source.wanted ?? []).map((path) => ({
        path, rel: path.slice(root.length + 1), kind: "update" as const, added: 1, removed: 0,
      })),
      more: 1,
    })
    const out = await spreadReview(dirs.home, {
      wanted: [join(dirs.repoA, "src/index.ts"), join(dirs.repoB, "src/index.ts")],
    }, one)
    expect(out?.files.map((f) => f.rel).sort()).toEqual(["repo-b/src/index.ts", "仓库甲/src/index.ts"])
    // 截断量是各仓库相加；跨仓库这一档要打上标记，界面据此说清口径
    expect(out?.more).toBe(2)
    expect(out?.spread).toBe(true)
    // 一个仓库都没碰过：整条路不成立，退回原来那句「不是 git 仓库」
    expect(await spreadReview(dirs.home, { wanted: ["/tmp/x.md"] }, one)).toBeUndefined()
  })
})
