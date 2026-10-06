import { describe, expect, it } from "vitest"
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk"
import { createProcessOwner, unpacked } from "./subprocess.js"

const FAST = { exitGraceMs: 200, termGraceMs: 400, killGraceMs: 400 }

function nodeProc(script: string): SpawnOptions {
  // signal 由 SDK 转发；测试里我们自己扮演 SDK，给一个从不 abort 的
  return {
    command: process.execPath,
    args: ["-e", script],
    env: process.env,
    signal: new AbortController().signal,
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

describe("回收阶梯", () => {
  it("没 spawn 过就回收，不报错", async () => {
    const report = await createProcessOwner(FAST).reclaim()
    expect(report.rung).toBe("never-spawned")
  })

  it("自己会退的进程走 graceful，不发信号", async () => {
    const owner = createProcessOwner(FAST)
    owner.spawn(nodeProc("setTimeout(()=>process.exit(0), 50)"))
    const report = await owner.reclaim()
    expect(report.rung).toBe("graceful")
  })

  it("已经退干净的进程识别为 already-exited", async () => {
    const owner = createProcessOwner(FAST)
    owner.spawn(nodeProc("process.exit(0)"))
    await new Promise((r) => setTimeout(r, 150))
    expect((await owner.reclaim()).rung).toBe("already-exited")
  })

  it("忽略 SIGTERM 的进程会被升级到 SIGKILL 收掉", async () => {
    const owner = createProcessOwner(FAST)
    const child = owner.spawn(
      nodeProc("process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000)"),
    )
    const report = await owner.reclaim()
    expect(report.rung).toBe("sigkill")
    // **直接探进程组**，而不是看 `child.killed` / `exitCode` / `signal`。
    // 那三个都是死亡的**代理指标**，而且都不可靠：我们是 `process.kill(-pid)` 收整棵树，
    // 不是 `child.kill()`，所以 `child.killed` 恒为 false；`exitCode`/`signal` 来自 Node
    // 的 `exit` 事件，**它可能比 `reclaim()` 返回得晚**——于是这条断言时灵时不灵。
    // 2026-08-15 它就这么红了一次，而被测代码没有任何问题。
    expect(alive(child.pid ?? 0)).toBe(false)
  })

  it("整树退出：孙子进程也被一起收掉——只看直接子进程是不够的", async () => {
    const owner = createProcessOwner(FAST)
    // 父进程 spawn 一个会赖着不走的孙子，然后自己也赖着
    const grandchild = `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)`
    owner.spawn(nodeProc(grandchild))
    await new Promise((r) => setTimeout(r, 200))
    const report = await owner.reclaim()
    const pid = report.pid
    expect(pid).toBeDefined()
    expect(report.rung).not.toBe("escaped")
    // 存在性探测：整个进程组一个都不剩，这才是退出证明
    expect(pid === undefined ? false : alive(pid)).toBe(false)
  })

  it("回收是幂等的，重复调用不抛", async () => {
    const owner = createProcessOwner(FAST)
    owner.spawn(nodeProc("process.exit(0)"))
    await owner.reclaim()
    expect((await owner.reclaim()).rung).toBe("already-exited")
  })
})

describe("pid", () => {
  it("跑着时给组长 pid——外发守卫靠它认出这一家；退了就不再给，免得把流量记到一个复用的 pid 上", async () => {
    const owner = createProcessOwner(FAST)
    expect(owner.pid()).toBeUndefined()
    const child = owner.spawn(nodeProc("setTimeout(()=>process.exit(0), 100)"))
    expect(owner.pid()).toBe(child.pid)
    await owner.died()
    expect(owner.pid()).toBeUndefined()
  })
})

describe("unpacked", () => {
  it("把指进 asar 的路径改到解包目录——spawn 交给操作系统，而 asar 是文件不是目录", () => {
    expect(unpacked("/Applications/Switchback.app/Contents/Resources/app.asar/node_modules/x/cli.js")).toBe(
      "/Applications/Switchback.app/Contents/Resources/app.asar.unpacked/node_modules/x/cli.js",
    )
  })

  it("没有 asar 的路径原样返回——开发时跑的是源码目录", () => {
    expect(unpacked("/Users/me/work/switchback/node_modules/x/cli.js")).toBe(
      "/Users/me/work/switchback/node_modules/x/cli.js",
    )
  })

  it("只替换目录段，不误伤名字里带 app.asar 的文件", () => {
    expect(unpacked("/w/my-app.asar-notes.txt")).toBe("/w/my-app.asar-notes.txt")
  })

  it("已经是 unpacked 的不再改", () => {
    const p = "/a/app.asar.unpacked/node_modules/x"
    expect(unpacked(p)).toBe(p)
  })
})
