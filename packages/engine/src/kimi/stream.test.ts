import { describe, expect, it } from "vitest"
import { KimiStream, type KimiDisconnect } from "./stream.js"

class FakeSocket {
  readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  readonly sent: string[] = []

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const found = this.listeners.get(type) ?? []
    found.push(listener)
    this.listeners.set(type, found)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.emit("close", {})
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  frame(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) })
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("Kimi WebSocket", () => {
  it("用 bearer 子协议和快照游标订阅，并转发事件与回应 ping", async () => {
    const sockets: FakeSocket[] = []
    const frames: unknown[] = []
    const protocols: (readonly string[])[] = []
    const stream = new KimiStream({
      wsUrl: "ws://127.0.0.1/api/v1/ws",
      protocol: "kimi-code.bearer.secret",
      sessionId: "s1",
      cursor: { seq: 8, epoch: "ep1" },
      onFrame: (frame) => frames.push(frame),
      onResync: () => Promise.resolve({ seq: 8, epoch: "ep1" }),
      onDisconnect: () => undefined,
      onRecovered: () => undefined,
      onFatal: () => undefined,
      socket: (_url, offered) => {
        protocols.push(offered)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    const connecting = stream.connect()
    sockets[0]?.frame({ type: "server_hello" })
    expect(JSON.parse(sockets[0]?.sent[0] ?? "null")).toEqual({
      type: "subscribe",
      id: "omni-subscribe",
      payload: { session_ids: ["s1"], cursors: { s1: { seq: 8, epoch: "ep1" } } },
    })
    sockets[0]?.frame({
      type: "ack",
      id: "omni-subscribe",
      code: 0,
      msg: "",
      payload: { accepted: ["s1"], resync_required: [] },
    })
    await connecting
    sockets[0]?.frame({ type: "ping", payload: { nonce: "n1" } })
    sockets[0]?.frame({
      type: "session_event",
      session_id: "s1",
      seq: 9,
      payload: { type: "turn.started" },
    })
    sockets[0]?.frame({
      type: "session_event",
      session_id: "s1",
      seq: 9,
      payload: { type: "turn.started" },
    })
    sockets[0]?.frame({
      type: "session_event",
      session_id: "s1",
      seq: 8,
      payload: { type: "turn.started" },
    })

    expect(protocols).toEqual([["kimi-code.bearer.secret"]])
    expect(JSON.parse(sockets[0]?.sent[1] ?? "null")).toEqual({
      type: "pong",
      payload: { nonce: "n1" },
    })
    expect(frames).toHaveLength(1)
    await stream.dispose()
  })

  it("订阅握手沉默时明确超时，不把会话永久留在启动中", async () => {
    const stream = new KimiStream({
      wsUrl: "ws://127.0.0.1/api/v1/ws",
      protocol: "p",
      sessionId: "s1",
      cursor: { seq: 0 },
      onFrame: () => undefined,
      onResync: () => Promise.resolve({ seq: 0 }),
      onDisconnect: () => undefined,
      onRecovered: () => undefined,
      onFatal: () => undefined,
      handshakeMs: 5,
      socket: () => new FakeSocket(),
    })

    await expect(stream.connect()).rejects.toThrow("订阅握手阶段没有响应")
    await stream.dispose()
  })

  it("断线后从新快照游标重连", async () => {
    const sockets: FakeSocket[] = []
    const lifecycle: string[] = []
    const stream = new KimiStream({
      wsUrl: "ws://127.0.0.1/api/v1/ws",
      protocol: "p",
      sessionId: "s1",
      cursor: { seq: 1 },
      onFrame: () => undefined,
      onResync: () => Promise.resolve({ seq: 11, epoch: "ep2" }),
      onDisconnect: () => lifecycle.push("disconnected"),
      onRecovered: () => lifecycle.push("recovered"),
      onFatal: () => lifecycle.push("fatal"),
      socket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    const connecting = stream.connect()
    sockets[0]?.frame({ type: "server_hello" })
    sockets[0]?.frame({
      type: "ack",
      id: "omni-subscribe",
      code: 0,
      msg: "",
      payload: { accepted: ["s1"], resync_required: [] },
    })
    await connecting
    sockets[0]?.close()
    await nextTick()
    sockets[1]?.frame({ type: "server_hello" })
    expect(JSON.parse(sockets[1]?.sent[0] ?? "null").payload.cursors).toEqual({
      s1: { seq: 11, epoch: "ep2" },
    })
    sockets[1]?.frame({
      type: "ack",
      id: "omni-subscribe",
      code: 0,
      msg: "",
      payload: { accepted: ["s1"], resync_required: [] },
    })
    await nextTick()

    expect(lifecycle).toEqual(["disconnected", "recovered"])
    await stream.dispose()
  })

  it("服务端明确要求 resync 时先跳到快照游标", async () => {
    const sockets: FakeSocket[] = []
    const stream = new KimiStream({
      wsUrl: "ws://127.0.0.1/api/v1/ws",
      protocol: "p",
      sessionId: "s1",
      cursor: { seq: 2, epoch: "old" },
      onFrame: () => undefined,
      onResync: () => Promise.resolve({ seq: 20, epoch: "new" }),
      onDisconnect: () => undefined,
      onRecovered: () => undefined,
      onFatal: () => undefined,
      socket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    const connecting = stream.connect()
    sockets[0]?.frame({ type: "server_hello" })
    sockets[0]?.frame({ type: "resync_required", session_id: "s1" })
    await nextTick()
    sockets[1]?.frame({ type: "server_hello" })
    expect(JSON.parse(sockets[1]?.sent[0] ?? "null").payload.cursors).toEqual({
      s1: { seq: 20, epoch: "new" },
    })
    sockets[1]?.frame({
      type: "ack",
      id: "omni-subscribe",
      code: 0,
      msg: "",
      payload: { accepted: ["s1"], resync_required: [] },
    })

    await connecting
    await stream.dispose()
  })

  it("客户端发现 offset 缺口时先读快照，再用新水位重连", async () => {
    const sockets: FakeSocket[] = []
    const resyncs: number[] = []
    const stream = new KimiStream({
      wsUrl: "ws://127.0.0.1/api/v1/ws",
      protocol: "p",
      sessionId: "s1",
      cursor: { seq: 2, epoch: "old" },
      onFrame: () => undefined,
      onResync: () => {
        resyncs.push(1)
        return Promise.resolve({ seq: 20, epoch: "new" })
      },
      onDisconnect: () => undefined,
      onRecovered: () => undefined,
      onFatal: () => undefined,
      socket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    const connecting = stream.connect()
    sockets[0]?.frame({ type: "server_hello" })
    sockets[0]?.frame({
      type: "ack",
      id: "omni-subscribe",
      code: 0,
      msg: "",
      payload: { accepted: ["s1"], resync_required: [] },
    })
    await connecting
    stream.requestResync()
    await nextTick()
    sockets[1]?.frame({ type: "server_hello" })

    expect(resyncs).toEqual([1])
    expect(JSON.parse(sockets[1]?.sent[0] ?? "null").payload.cursors).toEqual({
      s1: { seq: 20, epoch: "new" },
    })
    sockets[1]?.frame({
      type: "ack",
      id: "omni-subscribe",
      code: 0,
      msg: "",
      payload: { accepted: ["s1"], resync_required: [] },
    })
    await nextTick()
    await stream.dispose()
  })
})

describe("断开原因照实报", () => {
  const handshake = (socket: FakeSocket | undefined): void => {
    socket?.frame({ type: "server_hello" })
    socket?.frame({ type: "ack", id: "omni-subscribe", code: 0, msg: "", payload: { accepted: ["s1"], resync_required: [] } })
  }
  const boom = { type: "session_event", session_id: "s1", seq: 9, payload: { type: "boom" } }
  const cases: readonly { name: string; act: (stream: KimiStream, socket: FakeSocket | undefined) => void; want: KimiDisconnect }[] = [
    { name: "对面关的：带上关闭码和原因", act: (_s, socket) => socket?.emit("close", { code: 1001, reason: "heartbeat timeout" }), want: { kind: "closed", code: 1001, reason: "heartbeat timeout" } },
    { name: "没有关闭码就不编一个", act: (_s, socket) => socket?.emit("close", {}), want: { kind: "closed" } },
    { name: "omni 发现缺口、主动重同步", act: (stream) => stream.requestResync(), want: { kind: "resync", why: "omni 发现流里有缺口" } },
    { name: "服务端要求重同步", act: (_s, socket) => socket?.frame({ type: "resync_required", session_id: "s1" }), want: { kind: "resync", why: "服务端要求重新同步" } },
    { name: "omni 自己处理某一帧时出错", act: (_s, socket) => socket?.frame(boom), want: { kind: "error", message: "炸了" } },
  ]
  for (const one of cases) {
    it(one.name, async () => {
      const sockets: FakeSocket[] = []
      const causes: KimiDisconnect[] = []
      const stream = new KimiStream({
        wsUrl: "ws://127.0.0.1/api/v1/ws", protocol: "p", sessionId: "s1", cursor: { seq: 1 },
        onFrame: (frame) => {
          if ((frame.payload as { type?: string } | undefined)?.type === "boom") throw new Error("炸了")
        },
        onResync: () => Promise.resolve({ seq: 11 }),
        onDisconnect: (cause) => causes.push(cause),
        onRecovered: () => undefined,
        onFatal: () => undefined,
        socket: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      })
      const connecting = stream.connect()
      handshake(sockets[0])
      await connecting
      one.act(stream, sockets[0])
      await nextTick()
      expect(causes).toEqual([one.want])
      await stream.dispose()
    })
  }
})
