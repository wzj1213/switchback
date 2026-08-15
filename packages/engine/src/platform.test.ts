import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { isWindows, lookupCommand, tree } from "./platform.js"

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
    // 自己不是进程组组长，所以 -pid 指向一个不存在的组：报死是对的
    expect(tree.alive(process.pid)).toBe(false)

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
