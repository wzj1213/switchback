import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { isWindows, lookupCommand, resolveLoginPath, tree, type LoginPathDeps } from "./platform.js"

const run = promisify(execFile)

/**
 * 只能测跑得到的那一边。Windows 那几支在这台机器上永远不会执行——
 * 与其 mock 一个假的 `process.platform` 去验「我写的 if 还在」，
 * 不如把断言写成**当前平台上真的成立的事**，并在文档里明说另一边没验过。
 */
describe("平台适配", () => {
  it("查命令用的是这个平台真的有的那个", async () => {
    const lookup = lookupCommand()
    expect(lookup.command).toBe(isWindows ? "where.exe" : "which")
    // 不只是字符串对：这条命令本身得能跑
    await expect(run(lookup.command, lookup.args("node"))).resolves.toBeDefined()
  })

  it("**POSIX 上 alive 是整树证明，Windows 上不是**——报告不能在这一点上撒谎", () => {
    expect(tree.provesWholeTree).toBe(!isWindows)
  })

  it("**alive 问的是「这个 pid 领头的组」，不是「这个 pid」**——测试里踩到过", async () => {
    // POSIX 上自己不是进程组组长，所以 -pid 指向一个不存在的组：报死是对的。
    // Windows 上没有这层语义（问的就是这个 pid），所以自己一定是活的——
    // 这个差别正是 `provesWholeTree` 要报出来的那件事
    expect(tree.alive(process.pid)).toBe(isWindows)

    // detached 起来的才是组长，那才是回收阶梯要看的东西
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { detached: true })
    await new Promise((r) => setTimeout(r, 200))
    const pid = child.pid
    expect(pid).toBeDefined()
    if (pid === undefined) return
    expect(tree.alive(pid)).toBe(true)
    tree.kill(pid)
    await new Promise((r) => setTimeout(r, 300))
    expect(tree.alive(pid)).toBe(false)
  })

  it("不存在的 pid 报死，不抛", () => {
    // 2^22 之外，任何系统上都不会有这个 pid
    expect(tree.alive(4_194_303)).toBe(false)
  })
})

describe("从登录 shell 问 PATH", () => {
  const base = "/usr/bin:/bin"
  const deps = (out: string | undefined, platform = "darwin"): LoginPathDeps => ({
    shell: "/bin/zsh",
    home: "/Users/dev",
    platform,
    run: () => Promise.resolve(out),
  })

  it("从哨兵之间抠出 PATH", async () => {
    const got = await resolveLoginPath(base, deps("__OMNI_PATH__/opt/homebrew/bin:/usr/bin__OMNI_END__"))
    expect(got.split(":")).toContain("/opt/homebrew/bin")
  })

  it("**rc 文件的噪声不影响**——取最后一行不可靠，有人的 rc 结尾就打空行", async () => {
    const noisy = "nvm: 已加载\n今日运势：吉\n__OMNI_PATH__/opt/homebrew/bin__OMNI_END__\n"
    expect((await resolveLoginPath(base, deps(noisy))).split(":")).toContain("/opt/homebrew/bin")
  })

  it("问不到时**不能比原来窄**：原 PATH 一个不少，再垫上常见位置", async () => {
    const got = (await resolveLoginPath(base, deps(undefined))).split(":")
    expect(got).toContain("/usr/bin")
    expect(got).toContain("/bin")
    expect(got).toContain("/opt/homebrew/bin")
    expect(got).toContain("/Users/dev/.local/bin")
  })

  it("`~` 按传入的 home 展开，不读环境变量", async () => {
    expect((await resolveLoginPath(base, deps(undefined))).split(":")).toContain("/Users/dev/.bun/bin")
  })

  it("去重且保持先来的优先", async () => {
    const got = await resolveLoginPath("/a:/b", deps("__OMNI_PATH__/b:/c__OMNI_END__"))
    expect(got.split(":").slice(0, 3)).toEqual(["/b", "/c", "/a"])
  })

  it("**Windows 原样返回**：那边 GUI 进程正常继承环境变量，跑一次 shell 是纯风险", async () => {
    expect(await resolveLoginPath("C:\\bin", deps("__OMNI_PATH__/nope__OMNI_END__", "win32"))).toBe("C:\\bin")
  })
})
