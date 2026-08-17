import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { kindOf, isStaged, parseNumstat, looksBinary } from "../shared/review.js"
import { workPatch, workReview } from "./workdiff.js"

/**
 * **对着真的 git 跑。**
 *
 * 这个模块里每一条判断都建立在「git 的输出长什么样」之上，而那件事我猜错过一次：
 * `--numstat -z` 的改名条目路径那栏是**空的**，后面跟两段独立字段。按普通格式解，
 * 改名文件的增删数会静静地变成 0——不报错、不缺行，就是数字不对。
 * 造一个真仓库比读文档可靠。
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  })
}

const repo = { dir: "" }

beforeAll(() => {
  repo.dir = mkdtempSync(join(tmpdir(), "omni-review-"))
  git(repo.dir, "init", "-q")
  writeFileSync(join(repo.dir, "keep.txt"), "a\nb\nc\n")
  writeFileSync(join(repo.dir, "old.txt"), "x\ny\n")
  writeFileSync(join(repo.dir, "gone.txt"), "del\n")
  git(repo.dir, "add", "-A")
  git(repo.dir, "commit", "-qm", "init")
  // 一次把五种情况全摆出来：改、改名、删、未跟踪、已暂存
  writeFileSync(join(repo.dir, "keep.txt"), "a\nB\nc\nd\n")
  git(repo.dir, "mv", "old.txt", "new.txt")
  rmSync(join(repo.dir, "gone.txt"))
  writeFileSync(join(repo.dir, "fresh.txt"), "hi\nthere\n")
  mkdirSync(join(repo.dir, "sub"))
  writeFileSync(join(repo.dir, "sub", "deep.txt"), "deep\n")
  git(repo.dir, "add", "keep.txt")
})

afterAll(() => {
  if (repo.dir !== "") rmSync(repo.dir, { recursive: true, force: true })
})

describe("workReview", () => {
  it("五种状态一条不落，改名记在新名下", async () => {
    const out = await workReview(repo.dir)
    expect(out).toBeDefined()
    const by = new Map((out?.files ?? []).map((f) => [f.rel, f]))
    expect([...by.keys()].sort()).toEqual(["fresh.txt", "gone.txt", "keep.txt", "new.txt", "sub/deep.txt"])
    expect(by.get("keep.txt")?.kind).toBe("update")
    expect(by.get("gone.txt")?.kind).toBe("delete")
    expect(by.get("new.txt")?.kind).toBe("rename")
    expect(by.get("fresh.txt")?.kind).toBe("untracked")
  })

  it("未跟踪的目录摊成一个个文件，不是一条 `sub/`", async () => {
    const out = await workReview(repo.dir)
    expect((out?.files ?? []).map((f) => f.rel)).toContain("sub/deep.txt")
    expect((out?.files ?? []).map((f) => f.rel)).not.toContain("sub/")
  })

  it("改了一行的文件是 +2 −1，不是 0", async () => {
    const out = await workReview(repo.dir)
    const keep = (out?.files ?? []).find((f) => f.rel === "keep.txt")
    expect(keep?.added).toBe(2)
    expect(keep?.removed).toBe(1)
  })

  it("未跟踪文件的行数是读出来的——git 眼里它不存在，numstat 里没有它", async () => {
    const out = await workReview(repo.dir)
    expect((out?.files ?? []).find((f) => f.rel === "fresh.txt")?.added).toBe(2)
  })

  it("进了暂存区的标出来：`git diff` 默认看不见它们", async () => {
    const out = await workReview(repo.dir)
    const by = new Map((out?.files ?? []).map((f) => [f.rel, f]))
    expect(by.get("keep.txt")?.staged).toBe(true)
    expect(by.get("fresh.txt")?.staged).toBeUndefined()
  })

  it("绝对路径拼得对：要在访达里定位，得能对上", async () => {
    const out = await workReview(repo.dir)
    const keep = (out?.files ?? []).find((f) => f.rel === "keep.txt")
    expect(keep?.path.endsWith("/keep.txt")).toBe(true)
    expect(keep?.path.startsWith(out?.root ?? "/nope")).toBe(true)
  })

  it("不是 git 仓库就整个缺席，不是空列表——两者在界面上要长得不一样", async () => {
    const plain = mkdtempSync(join(tmpdir(), "omni-plain-"))
    try {
      expect(await workReview(plain)).toBeUndefined()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe("workPatch", () => {
  it("改过的文件给真正的 unified diff（带 @@ 和前缀）", async () => {
    const out = await workPatch(repo.dir, "keep.txt")
    expect(out.patch).toContain("@@")
    expect(out.patch).toContain("-b")
    expect(out.patch).toContain("+B")
    expect(out.added).toBe(2)
    expect(out.removed).toBe(1)
  })

  it("未跟踪文件走 --no-index：它的退出码是 1，不能当失败", async () => {
    const out = await workPatch(repo.dir, "fresh.txt")
    expect(out.skip).toBeUndefined()
    expect(out.patch).toContain("+hi")
    expect(out.added).toBe(2)
  })

  it("删掉的文件也有补丁", async () => {
    const out = await workPatch(repo.dir, "gone.txt")
    expect(out.patch).toContain("-del")
  })

  it("二进制文件不给正文，但要说是二进制", async () => {
    writeFileSync(join(repo.dir, "blob.bin"), Buffer.from([0, 1, 2, 0, 255, 0]))
    const out = await workPatch(repo.dir, "blob.bin")
    expect(out.skip).toBe("binary")
    expect(out.patch).toBe("")
  })

  it("跳出仓库的路径一律拒", async () => {
    for (const rel of ["../../etc/passwd", "/etc/passwd", ""]) {
      expect((await workPatch(repo.dir, rel)).skip).toBe("gone")
    }
  })
})

describe("纯解析", () => {
  it("parseNumstat 认得改名那种「路径栏是空的」形状", () => {
    // 真的输出：上面那个仓库里 `git diff HEAD --numstat -z -M` 逐字节抄下来的
    const raw = "0\t1\tgone.txt\u00002\t1\tkeep.txt\u00000\t0\t\u0000old.txt\u0000new.txt\u0000"
    const out = parseNumstat(raw)
    expect(out.get("keep.txt")).toEqual({ added: 2, removed: 1 })
    expect(out.get("new.txt")).toEqual({ added: 0, removed: 0 })
    expect(out.has("old.txt")).toBe(false)
  })

  it("kindOf 取「更能说明发生了什么」的那一位", () => {
    expect(kindOf("??")).toBe("untracked")
    expect(kindOf(" M")).toBe("update")
    expect(kindOf("AM")).toBe("add")
    expect(kindOf("MD")).toBe("delete")
    expect(kindOf("R ")).toBe("rename")
  })

  it("isStaged 只看第一位，未跟踪不算暂存", () => {
    expect(isStaged("M ")).toBe(true)
    expect(isStaged(" M")).toBe(false)
    expect(isStaged("??")).toBe(false)
  })

  it("looksBinary 看的是 NUL", () => {
    expect(looksBinary(Buffer.from("hello\n"))).toBe(false)
    expect(looksBinary(Buffer.from([104, 0, 105]))).toBe(true)
  })
})
