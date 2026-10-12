import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ServerFrame } from "@switchback/wire"
import { createTransport, type ConnState } from "./transport.js"

/**
 * 一条假的浏览器 WebSocket。只做传输层用到的那几样：状态、发、关、四个回调。
 * 测试用 `accept` / `deliver` / `drop` 从「服务端」那头推它。
 */
class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static made: FakeSocket[] = []
  readyState = FakeSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | undefined
  onmessage: ((event: { data: string }) => void) | undefined
  onclose: ((event: { reason: string }) => void) | undefined
  onerror: (() => void) | undefined
  constructor(
    readonly url: string,
    readonly protocols: readonly string[],
  ) {
    FakeSocket.made.push(this)
  }
  send(text: string): void {
    this.sent.push(text)
  }
  close(_code?: number, reason = ""): void {
    this.drop(reason)
  }
  accept(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  deliver(frame: ServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  drop(reason = ""): void {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.onclose?.({ reason })
  }
}

function boot(verdict: "ok" | "denied" | "unknown" = "ok") {
  const states: ConnState[] = []
  const frames: ServerFrame[] = []
  const transport = createTransport({
    token: "t0k",
    authorize: () => Promise.resolve(verdict),
    onFrame: (frame) => frames.push(frame),
    onState: (state) => states.push(state),
    hello: () => ({ type: "hello" }),
  })
  return { transport, states, frames, kinds: () => states.map((s) => s.kind) }
}

const socket = (n: number): FakeSocket => {
  const one = FakeSocket.made[n]
  if (one === undefined) throw new Error(`没有第 ${String(n + 1)} 条连接`)
  return one
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.made = []
  vi.stubGlobal("WebSocket", FakeSocket)
  vi.stubGlobal("window", { location: { protocol: "https:", host: "relay.example:8443" } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("浏览器端的连接", () => {
  it("令牌认了才开 socket：同源 wss、令牌走子协议；开了先发 hello", async () => {
    const h = boot()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket(0).url).toBe("wss://relay.example:8443/api/stream")
    expect(socket(0).protocols).toEqual(["switchback.v1", "t0k"])
    socket(0).accept()
    expect(h.kinds()).toEqual(["connecting", "open"])
    expect(socket(0).sent.map((t) => JSON.parse(t) as unknown)).toEqual([{ type: "hello" }])
  })

  it("帧原样交出去；没连上时 send 回 false", async () => {
    const h = boot()
    expect(h.transport.send({ type: "ping" })).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    socket(0).accept()
    socket(0).deliver({ type: "pong" })
    expect(h.frames).toEqual([{ type: "pong" }])
    expect(h.transport.send({ type: "ping" })).toBe(true)
  })

  it("**断了按退避重连**，回来时再发一次 hello", async () => {
    const h = boot()
    await vi.advanceTimersByTimeAsync(0)
    socket(0).accept()
    socket(0).drop("网断了")
    expect(h.states.at(-1)).toEqual({ kind: "retrying", inMs: 1000, reason: "网断了" })
    await vi.advanceTimersByTimeAsync(1000)
    socket(1).accept()
    expect(socket(1).sent.map((t) => JSON.parse(t) as unknown)).toEqual([{ type: "hello" }])
  })

  it("**令牌不认就停**，不再重试——重试一万次也还是这个结果", async () => {
    const h = boot("denied")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.kinds()).toEqual(["connecting", "unauthorized"])
    expect(FakeSocket.made).toHaveLength(0)
  })

  it("问不出来当网络问题，接着退避重试，**不把人踢回配对屏**", async () => {
    const h = boot("unknown")
    await vi.advanceTimersByTimeAsync(0)
    expect(h.states.at(-1)).toMatchObject({ kind: "retrying", reason: "连不上 Switchback" })
  })

  it("关掉之后连接断了也不重连", async () => {
    const h = boot()
    await vi.advanceTimersByTimeAsync(0)
    socket(0).accept()
    h.transport.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.made).toHaveLength(1)
    expect(h.kinds().at(-1)).toBe("closed")
  })

  it("连着时 poke 不会再开一条", async () => {
    const h = boot()
    await vi.advanceTimersByTimeAsync(0)
    socket(0).accept()
    h.transport.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.made).toHaveLength(1)
  })
})
