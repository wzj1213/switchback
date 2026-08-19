import { describe, expect, it } from "vitest"
import { createTerminalHost } from "./terminal.js"

/**
 * 真起进程（`echo` / `sh -c`），不打桩。
 *
 * 打桩的话这里只剩「我写的 if 分支还在」，而这个模块要验的恰恰是**和真实
 * 子进程的交互**——`error` 和 `exit` 哪个会到、env 是数组还是对象、
 * 输出截断从哪头丢。这几样猜错都不会报错，只会让 agent 拿到一份空输出。
 */

async function run(params: Record<string, unknown>, cwd = process.cwd()): Promise<{
  output: string
  truncated: boolean
  exitStatus?: { exitCode?: number; signal?: string }
}> {
  const host = createTerminalHost(cwd)
  const made = (await host.handle("terminal/create", params)) as { terminalId: string }
  await host.handle("terminal/wait_for_exit", { terminalId: made.terminalId })
  const out = (await host.handle("terminal/output", { terminalId: made.terminalId })) as {
    output: string
    truncated: boolean
    exitStatus?: { exitCode?: number; signal?: string }
  }
  host.disposeAll()
  return out
}

describe("替 agent 起进程", () => {
  it("跑一条命令，输出和退出码都回得来", async () => {
    const out = await run({ command: "echo", args: ["你好"] })
    expect(out.output.trim()).toBe("你好")
    expect(out.exitStatus?.exitCode).toBe(0)
  })

  it("stderr 和 stdout 合流——agent 那边只有一个 `output` 字段", async () => {
    const out = await run({ command: "sh", args: ["-c", "echo A; echo B 1>&2"] })
    expect(out.output).toContain("A")
    expect(out.output).toContain("B")
  })

  it("非零退出码原样报，不抹平成 0", async () => {
    const out = await run({ command: "sh", args: ["-c", "exit 3"] })
    expect(out.exitStatus?.exitCode).toBe(3)
  })

  // 命令不存在时 node 只发 `error`，**没有 `exit`**——不接这条的话
  // `wait_for_exit` 永远不回，整轮挂死
  it("命令不存在也要落终态，而不是永远等下去", async () => {
    const out = await run({ command: "这个命令一定不存在-xyz", args: [] })
    expect(out.exitStatus).toBeDefined()
    expect(out.output).not.toBe("")
  })

  // 线上 env 是**数组** `[{name, value}]`。写成对象解析会得到空环境，
  // 而那个错误的表现是「连 git 都找不到」，看起来像用户机器上没装
  it("env 是数组形状，而且**继承父环境**（不然 PATH 就没了）", async () => {
    const out = await run({
      command: "sh",
      args: ["-c", "echo $OMNI_TEST_VAR; command -v sh >/dev/null && echo PATH_OK"],
      env: [{ name: "OMNI_TEST_VAR", value: "设上了" }],
    })
    expect(out.output).toContain("设上了")
    expect(out.output).toContain("PATH_OK")
  })

  it("cwd 用 agent 给的那个", async () => {
    const out = await run({ command: "sh", args: ["-c", "pwd"], cwd: "/tmp" })
    expect(out.output).toContain("tmp")
  })

  // 截断从**头部**丢：命令的结论通常在末尾
  it("超出上限时截断，标出 truncated，并且留的是末尾", async () => {
    const out = await run({
      command: "sh",
      args: ["-c", "for i in 1 2 3 4 5 6 7 8 9; do echo AAAAAAAAAA; done; echo 末尾"],
      outputByteLimit: 30,
    })
    expect(out.truncated).toBe(true)
    expect(out.output).toContain("末尾")
    expect(out.output.length).toBeLessThanOrEqual(30)
  })

  it("不归它管的方法回 undefined，让调用方去回 -32601", () => {
    const host = createTerminalHost(process.cwd())
    expect(host.handle("session/request_permission", {})).toBeUndefined()
    host.disposeAll()
  })

  // agent 收尾时 release 可能迟到一步。抛出去只会在轮次末尾多一条红字
  it("认得方法但找不到那条终端时回空壳，不抛", async () => {
    const host = createTerminalHost(process.cwd())
    await expect(host.handle("terminal/output", { terminalId: "没有这个" })).resolves.toEqual({})
    host.disposeAll()
  })
})
