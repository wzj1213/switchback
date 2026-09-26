import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { archiveKindOf, commandIn, installBinary, pruneAgents, type InstallDeps } from "./acp-install.js"
import { runCommand } from "./enginever-command.js"

/** 用系统 tar / ditto 现打一个真归档，喂给注入的 fetch——不联网，但解包走的是真命令。 */
function archiveOf(kind: "tgz" | "zip" | "raw"): { bytes: Buffer; sha: string } {
  const work = mkdtempSync(join(tmpdir(), "omni-archive-"))
  const src = join(work, "src")
  mkdirSync(join(src, "bin"), { recursive: true })
  writeFileSync(join(src, "bin", "agent"), "#!/bin/sh\necho hi\n", "utf8")
  const out = join(work, `a.${kind}`)
  if (kind === "tgz") execFileSync("tar", ["-czf", out, "-C", src, "bin"])
  else if (kind === "zip") execFileSync("ditto", ["-c", "-k", join(src, "bin"), out, "--keepParent"])
  else writeFileSync(out, "#!/bin/sh\necho raw\n", "utf8")
  const bytes = readFileSync(out)
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex") }
}

function deps(bytes: Buffer, root = mkdtempSync(join(tmpdir(), "omni-agents-"))): InstallDeps & { asked: string[]; phases: string[] } {
  const asked: string[] = []
  const phases: string[] = []
  return {
    root, asked, phases, platform: process.platform, run: runCommand,
    fetch: ((url: string) => {
      asked.push(url)
      return Promise.resolve(new Response(new Uint8Array(bytes), { status: 200, headers: { "content-length": String(bytes.length) } }))
    }) as unknown as typeof fetch,
    onProgress: (phase) => phases.push(phase),
  }
}

const agent = { id: "goose", version: "1.52.0" }

describe("归档类型与命令路径", () => {
  const table: readonly [string, string][] = [
    ["https://x/y/goose-aarch64-apple-darwin.tar.bz2", "tar"],
    ["https://x/y/a.tgz?sig=1", "tar"],
    ["https://x/y/a.ZIP", "zip"],
    ["https://x/y/cortex-1.0%2B1-darwin-arm64.tar.gz", "tar"],
    ["https://x/y/agent", "raw"],
  ]
  for (const [url, want] of table) it(url, () => expect(archiveKindOf(url)).toBe(want))

  it("命令必须落在版本目录里面", () => {
    expect(commandIn("/d/goose/1.0", "./goose")).toBe("/d/goose/1.0/goose")
    expect(commandIn("/d/goose/1.0", "../../x")).toBeUndefined()
    expect(commandIn("/d/goose/1.0", "/bin/sh")).toBeUndefined()
  })
})

describe("装一家只发二进制的引擎", () => {
  it("tar 包：下载、校验、解包、挪到位、可执行", async () => {
    const { bytes, sha } = archiveOf("tgz")
    const d = deps(bytes)
    const done = await installBinary(agent, { archive: "https://x/goose.tar.gz", cmd: "./bin/agent", args: ["acp"], sha256: sha }, d)
    expect(done).toEqual({ ok: true, command: join(d.root, "goose", "1.52.0", "bin", "agent") })
    if (done.ok) accessSync(done.command, constants.X_OK)
    expect(d.phases).toContain("extract")
    // 半截的暂存目录不留
    expect(execFileSync("ls", ["-a", join(d.root, "goose")], { encoding: "utf8" }).split("\n").filter((n) => n.startsWith(".staging"))).toEqual([])
  })

  it("已经装过同一版本：不再下载", async () => {
    const { bytes, sha } = archiveOf("tgz")
    const d = deps(bytes)
    const dist = { archive: "https://x/goose.tar.gz", cmd: "./bin/agent", args: [], sha256: sha }
    await installBinary(agent, dist, d)
    await installBinary(agent, dist, d)
    expect(d.asked).toHaveLength(1)
  })

  it("sha256 对不上：一个文件都不解包", async () => {
    const { bytes } = archiveOf("tgz")
    const d = deps(bytes)
    const done = await installBinary(agent, { archive: "https://x/goose.tar.gz", cmd: "./bin/agent", args: [], sha256: "0".repeat(64) }, d)
    expect(done.ok).toBe(false)
    if (!done.ok) expect(done.error).toContain("校验没过")
    expect(existsSync(join(d.root, "goose", "1.52.0"))).toBe(false)
  })

  it("解包后没有注册表说的那个文件：照实报，不留半截", async () => {
    const { bytes } = archiveOf("tgz")
    const d = deps(bytes)
    const done = await installBinary(agent, { archive: "https://x/goose.tar.gz", cmd: "./nope", args: [] }, d)
    expect(done.ok).toBe(false)
    expect(existsSync(join(d.root, "goose", "1.52.0"))).toBe(false)
  })

  it("裸二进制：原样放到 cmd 指的位置", async () => {
    const { bytes } = archiveOf("raw")
    const d = deps(bytes)
    const done = await installBinary(agent, { archive: "https://x/agent", cmd: "./agent", args: [] }, d)
    expect(done).toEqual({ ok: true, command: join(d.root, "goose", "1.52.0", "agent") })
  })

  it.runIf(process.platform === "darwin")("zip 包（macOS 用 ditto）", async () => {
    const { bytes, sha } = archiveOf("zip")
    const d = deps(bytes)
    const done = await installBinary(agent, { archive: "https://x/goose.zip", cmd: "./bin/agent", args: [], sha256: sha }, d)
    expect(done.ok).toBe(true)
  })
})

describe("收掉没人用的旧版本", () => {
  it("只留还有条目在用的版本目录", async () => {
    const root = mkdtempSync(join(tmpdir(), "omni-prune-"))
    for (const dir of ["goose/1.0.0", "goose/1.1.0", "goose/.staging-x", "opencode/2.0.0"]) mkdirSync(join(root, dir), { recursive: true })
    const keep = [join(root, "goose", "1.1.0", "goose"), join(root, "opencode", "2.0.0", "bin", "opencode")]
    // 刚动过的暂存目录可能正在下载：先不删
    const fresh = await pruneAgents(root, keep)
    expect(fresh.map((path) => path.slice(root.length + 1)).sort()).toEqual(["goose/1.0.0"])
    expect(existsSync(join(root, "goose", ".staging-x"))).toBe(true)
    // 放了一个多小时的才是真残留
    const later = await pruneAgents(root, keep, Date.now() + 2 * 60 * 60_000)
    expect(later.map((path) => path.slice(root.length + 1))).toEqual(["goose/.staging-x"])
    expect(existsSync(join(root, "goose", "1.1.0"))).toBe(true)
  })
})
