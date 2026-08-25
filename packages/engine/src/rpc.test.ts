import { describe, expect, it, vi } from "vitest"
import { createRpc, type RpcHandlers, type ServerCall } from "./rpc.js"

interface Harness {
  sent: string[]
  notifications: { method: string; params: unknown }[]
  requests: ServerCall[]
  garbage: string[]
}

const harness = (): { rpc: ReturnType<typeof createRpc>; h: Harness } => {
  const h: Harness = { sent: [], notifications: [], requests: [], garbage: [] }
  const handlers: RpcHandlers = {
    send: (line) => h.sent.push(line),
    onNotification: (method, params) => h.notifications.push({ method, params }),
    onRequest: (call) => h.requests.push(call),
    onGarbage: (line) => h.garbage.push(line),
  }
  return { rpc: createRpc(handlers), h }
}

describe("createRpc 分帧", () => {
  it("一次喂进来的半行留到下一次——stdio 不保证按行到达", () => {
    const { rpc, h } = harness()
    rpc.feed('{"method":"a","par')
    expect(h.notifications).toEqual([])
    rpc.feed('ams":1}\n')
    expect(h.notifications).toEqual([{ method: "a", params: 1 }])
  })

  it("一次喂进来的多行全部派发", () => {
    const { rpc, h } = harness()
    rpc.feed('{"method":"a"}\n{"method":"b"}\n')
    expect(h.notifications.map((n) => n.method)).toEqual(["a", "b"])
  })

  it("坏行走 onGarbage，不抛——对端多打一行日志不该掀翻会话", () => {
    const { rpc, h } = harness()
    rpc.feed("这不是 JSON\n")
    expect(h.garbage).toEqual(["这不是 JSON"])
    expect(h.notifications).toEqual([])
  })
})

describe("createRpc 请求应答", () => {
  it("按 id 对上应答", async () => {
    const { rpc, h } = harness()
    const pending = rpc.call("thread/start", { cwd: "/w" })
    const sent = JSON.parse(h.sent[0] ?? "{}") as { id: number; method: string }
    expect(sent.method).toBe("thread/start")
    rpc.feed(`${JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { ok: true } })}\n`)
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it("错误应答 reject", async () => {
    const { rpc, h } = harness()
    const pending = rpc.call("x")
    const sent = JSON.parse(h.sent[0] ?? "{}") as { id: number }
    rpc.feed(`${JSON.stringify({ jsonrpc: "2.0", id: sent.id, error: { message: "炸了" } })}\n`)
    await expect(pending).rejects.toThrow("炸了")
  })

  it("带 method 的 id 是服务端请求，不是应答", () => {
    const { rpc, h } = harness()
    rpc.feed('{"jsonrpc":"2.0","id":7,"method":"item/fileChange/requestApproval","params":{"itemId":"a"}}\n')
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]?.id).toBe(7)
    expect(h.requests[0]?.method).toBe("item/fileChange/requestApproval")
  })

  it("respond 幂等——重复应答同一个 id 只发第一次", () => {
    const { rpc, h } = harness()
    rpc.feed('{"jsonrpc":"2.0","id":7,"method":"m","params":{}}\n')
    h.requests[0]?.respond({ decision: "accept" })
    h.requests[0]?.respond({ decision: "decline" })
    expect(h.sent).toHaveLength(1)
    expect(JSON.parse(h.sent[0] ?? "{}")).toEqual({ jsonrpc: "2.0", id: 7, result: { decision: "accept" } })
  })

  it("reject 写成 JSON-RPC 顶层 error，并与 respond 共用幂等闸门", () => {
    const { rpc, h } = harness()
    rpc.feed('{"jsonrpc":"2.0","id":8,"method":"future/method","params":{}}\n')
    h.requests[0]?.reject({ code: -32601, message: "Method not found" })
    h.requests[0]?.respond({})
    expect(h.sent).toHaveLength(1)
    expect(JSON.parse(h.sent[0] ?? "{}")).toEqual({
      jsonrpc: "2.0", id: 8, error: { code: -32601, message: "Method not found" },
    })
  })
})

describe("createRpc 关闭", () => {
  it("close 落定所有在途请求——不然 dispose 会顶在 await 上永远回不来", async () => {
    const { rpc } = harness()
    const a = rpc.call("a")
    const b = rpc.call("b")
    rpc.close("会话正在关闭")
    await expect(a).rejects.toThrow("会话正在关闭")
    await expect(b).rejects.toThrow("会话正在关闭")
  })

  it("关闭后不再发送任何东西", async () => {
    const { rpc, h } = harness()
    rpc.close("停")
    rpc.notify("x")
    await expect(rpc.call("y")).rejects.toThrow("连接已关闭")
    expect(h.sent).toEqual([])
  })

  it("close 幂等", () => {
    const { rpc } = harness()
    const spy = vi.fn()
    rpc.call("a").catch(spy)
    rpc.close("一")
    rpc.close("二")
    expect(spy).toHaveBeenCalledTimes(0) // 还没进微任务，这里只验证不抛
  })
})
