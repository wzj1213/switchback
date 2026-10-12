import { describe, expect, it } from "vitest"
import type { ClientFrame } from "@switchback/wire"
import { createCalls } from "./calls.js"

/** 假时钟 + 一条能开能关的线。 */
function harness(open = true) {
  const wire: ClientFrame[] = []
  const timers = new Map<number, () => void>()
  const line = { open, next: 0 }
  const calls = createCalls({
    send: (frame) => {
      if (!line.open) return false
      wire.push(frame)
      return true
    },
    setTimer: (run) => {
      line.next += 1
      timers.set(line.next, run)
      return line.next
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
  })
  return {
    calls,
    wire,
    /** 让所有还没清掉的计时器到点。 */
    expire: () => {
      for (const run of [...timers.values()]) run()
    },
    connect: () => {
      line.open = true
      calls.opened()
    },
    timers,
  }
}

describe("客户端的调用", () => {
  it("连着时立刻发，回话按 id 了结", async () => {
    const h = harness()
    const answer = h.calls.call("switchback:worksite", { cwd: "/w" })
    expect(h.wire).toEqual([{ type: "call", id: 1, method: "switchback:worksite", arg: { cwd: "/w" } }])
    h.calls.settle({ type: "result", id: 1, ok: true, value: { branch: "main" } })
    await expect(answer).resolves.toEqual({ branch: "main" })
    expect(h.calls.size()).toBe(0)
    // 了结之后计时器也清掉了
    expect(h.timers.size).toBe(0)
  })

  it("被拒的原话就是 Error 的消息", async () => {
    const h = harness()
    const answer = h.calls.call("switchback:selfUpdate")
    h.calls.settle({ type: "result", id: 1, ok: false, reason: "只能在那台机器上做" })
    await expect(answer).rejects.toThrow("只能在那台机器上做")
  })

  it("**没连上时先排着，连上就发**——页面刚打开那一刻 WebSocket 多半还在握手", async () => {
    const h = harness(false)
    const answer = h.calls.call("switchback:settings")
    expect(h.wire).toEqual([])
    h.connect()
    expect(h.wire).toEqual([{ type: "call", id: 1, method: "switchback:settings" }])
    h.calls.settle({ type: "result", id: 1, ok: true, value: "s" })
    await expect(answer).resolves.toBe("s")
  })

  it("**排着的也按时失败**，不会永远挂着", async () => {
    const h = harness(false)
    const answer = h.calls.call("switchback:settings", undefined, 30_000)
    h.expire()
    await expect(answer).rejects.toThrow("等了 30 秒")
    expect(h.calls.size()).toBe(0)
  })

  it("**断线时已经发出去的失败、不重发**——提交重发一次就可能提交两次", async () => {
    const h = harness()
    const sent = h.calls.call("switchback:gitCommit", { message: "m" })
    h.calls.dropped("网断了")
    await expect(sent).rejects.toThrow("这一下没有做完")
    h.connect()
    // 重连之后线上没有第二条 gitCommit
    expect(h.wire.filter((f) => f.type === "call")).toHaveLength(1)
  })

  it("断线时**还没发出去的接着排**，连上再发", async () => {
    const h = harness(false)
    const queued = h.calls.call("switchback:worksite")
    h.calls.dropped("网断了")
    h.connect()
    h.calls.settle({ type: "result", id: 1, ok: true, value: 1 })
    await expect(queued).resolves.toBe(1)
  })

  it("关掉时全部失败，原因照原样", async () => {
    const h = harness(false)
    const a = h.calls.call("switchback:worksite")
    const b = h.calls.call("switchback:settings")
    h.calls.close("这台设备已被吊销")
    await expect(a).rejects.toThrow("这台设备已被吊销")
    await expect(b).rejects.toThrow("这台设备已被吊销")
  })

  it("认不出的回话 id 不理（迟到的、重复的）", () => {
    const h = harness()
    expect(() => {
      h.calls.settle({ type: "result", id: 99, ok: true })
    }).not.toThrow()
  })
})
