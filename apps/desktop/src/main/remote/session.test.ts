import { describe, expect, it } from "vitest"
import type { Command, Event, Trust } from "@omni/protocol"
import { createLedger, createReassembler, type ServerFrame } from "@omni/wire"
import { createSession } from "./session.js"
import type { Sink } from "../sink.js"

const RUN = "run-a"

const ev = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: String(n) })

interface Harness {
  session: ReturnType<typeof createSession>
  ledger: ReturnType<typeof createLedger>
  /** 客户端那侧收到的帧（已经过重组）。 */
  frames: () => readonly ServerFrame[]
  dispatched: () => readonly Command[]
  replays: () => number
  closed: () => { code: number; reason: string } | undefined
  logs: () => readonly string[]
  buffer: (bytes: number) => void
}

function harness(options: { ceiling?: Trust; replayFails?: boolean; threadTrust?: Trust } = {}): Harness {
  const ledger = createLedger(RUN, 100)
  const wire: string[] = []
  const dispatched: Command[] = []
  const logs: string[] = []
  const state = { replays: 0, closed: undefined as { code: number; reason: string } | undefined, buffered: 0 }
  const session = createSession({
    id: "c1",
    send: (text) => wire.push(text),
    close: (code, reason) => {
      state.closed = { code, reason }
    },
    buffered: () => state.buffered,
    ledger,
    dispatch: (command) => dispatched.push(command),
    replay: async (_sink: Sink) => {
      state.replays += 1
      if (options.replayFails === true) throw new Error("磁盘炸了")
    },
    ceiling: () => options.ceiling ?? "full",
    trustOf: () => options.threadTrust,
    log: (_level, message) => logs.push(message),
  })
  return {
    session,
    ledger,
    frames: () => {
      const reassembler = createReassembler()
      const out: ServerFrame[] = []
      for (const text of wire) {
        const seen = reassembler.observe(text)
        if (seen.kind === "frame") out.push(seen.frame)
      }
      return out
    },
    dispatched: () => dispatched,
    replays: () => state.replays,
    closed: () => state.closed,
    logs: () => logs,
    buffer: (bytes) => {
      state.buffered = bytes
    },
  }
}

const send = (h: Harness, frame: unknown): void => {
  h.session.receive(JSON.stringify(frame))
}

describe("握手", () => {
  it("不带游标的 hello → 走全量重建，并进账本", () => {
    const h = harness()
    send(h, { type: "hello" })
    expect(h.replays()).toBe(1)
    expect(h.ledger.stats().acked["c1"]).toBe(0)
  })

  it("**带得上的游标只补差量**——这正是隧道和地铁的意义所在", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2), ev(3)])
    send(h, { type: "hello", after: 1, epoch: RUN })
    expect(h.replays()).toBe(0)
    const frame = h.frames()[0]
    expect(frame?.type).toBe("events")
    expect(frame?.type === "events" ? frame.sealed.map((s) => s.seq) : []).toEqual([2, 3])
  })

  it("游标正好是最新的 → 什么都不发，也不重建", () => {
    const h = harness()
    h.ledger.seal([ev(1)])
    send(h, { type: "hello", after: 1, epoch: RUN })
    expect(h.replays()).toBe(0)
    expect(h.frames()).toEqual([])
  })

  it("**缺口太老 → 转全量，绝不补一半**", () => {
    const h = harness()
    const ledger = createLedger(RUN, 2)
    // 用一个小缓冲重建一次：填 10 条，只留最后 2 条
    for (let i = 1; i <= 10; i += 1) ledger.seal([ev(i)])
    expect(ledger.since(1, RUN)).toBeUndefined()
    // 会话侧的行为：转全量
    send(h, { type: "hello", after: 999, epoch: RUN })
    expect(h.replays()).toBe(1)
  })

  it("全量重建失败时明说，让客户端重连——不是静默什么都不发", async () => {
    const h = harness({ replayFails: true })
    send(h, { type: "hello" })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.frames().some((f) => f.type === "reset")).toBe(true)
  })
})

describe("命令", () => {
  it("认得出的命令原样转给宿主", () => {
    const h = harness()
    send(h, { type: "command", command: { type: "thread.prompt", threadId: "t", text: "hi" } })
    expect(h.dispatched()).toEqual([{ type: "thread.prompt", threadId: "t", text: "hi" }])
  })

  it("**认不出的形状一律丢弃，并留一行日志**——不能把任意 JSON 喂进宿主", () => {
    const h = harness()
    send(h, { type: "command", command: { type: "rm -rf", threadId: "t" } })
    send(h, { type: "command", command: null })
    send(h, { type: "command", command: "字符串" })
    expect(h.dispatched()).toEqual([])
    expect(h.logs().filter((l) => l.includes("认不出")).length).toBe(3)
  })

  it("超过上限的档位被钳下来，并说清楚", () => {
    const h = harness({ ceiling: "read-only" })
    send(h, { type: "command", command: { type: "thread.create", cwd: "/w", engine: "codex", trust: "full" } })
    expect(h.dispatched()[0]).toMatchObject({ trust: "read-only" })
    expect(h.logs().some((l) => l.includes("上限"))).toBe(true)
  })
})

describe("确认与观察", () => {
  it("ack 落到账本上", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2)])
    send(h, { type: "hello" })
    send(h, { type: "ack", seq: 2 })
    expect(h.ledger.stats().acked["c1"]).toBe(2)
  })

  it("ack 的字段不是数字就忽略，不抛", () => {
    const h = harness()
    send(h, { type: "hello" })
    send(h, { type: "ack", seq: "2" })
    expect(h.ledger.stats().acked["c1"]).toBe(0)
  })

  it("watch 记住它在看哪条；null 表示不看正文", () => {
    const h = harness()
    send(h, { type: "watch", threadId: "t-1" })
    expect(h.session.sink.watching?.()).toBe("t-1")
    send(h, { type: "watch", threadId: null })
    expect(h.session.sink.watching?.()).toBeUndefined()
  })

  it("ping 回 pong", () => {
    const h = harness()
    send(h, { type: "ping" })
    expect(h.frames()).toEqual([{ type: "pong" }])
  })
})

describe("坏输入", () => {
  it("不是 JSON → 丢掉并记一行，连接不断", () => {
    const h = harness()
    h.session.receive("{坏的")
    expect(h.logs().some((l) => l.includes("合法 JSON"))).toBe(true)
    expect(h.closed()).toBeUndefined()
  })

  it("**认不出的帧类型只是忽略，不断连接**——对端可能只是比我们新", () => {
    const h = harness()
    send(h, { type: "从未来来的帧" })
    expect(h.closed()).toBeUndefined()
    expect(h.frames()).toEqual([])
  })

  it("JSON 是标量时也不抛", () => {
    const h = harness()
    h.session.receive("42")
    h.session.receive("null")
    expect(h.closed()).toBeUndefined()
  })
})

describe("背压", () => {
  it("**积压过大就断开，不在内存里替它攒**——它重连时走全量，那条路本来就设计好了", () => {
    const h = harness()
    h.buffer(9 * 1024 * 1024)
    send(h, { type: "ping" })
    expect(h.closed()?.code).toBe(1013)
    expect(h.session.sink.alive()).toBe(false)
  })

  it("断开之后不再写任何东西", () => {
    const h = harness()
    h.buffer(9 * 1024 * 1024)
    send(h, { type: "ping" })
    const before = h.frames().length
    send(h, { type: "ping" })
    expect(h.frames().length).toBe(before)
  })
})

describe("大帧", () => {
  it("超过一片的全量会被切开，客户端能原样重组回来", () => {
    const h = harness()
    const big = Array.from({ length: 3000 }, (_, i) => ev(i))
    h.session.sink.send({ channel: "omni:replay", replay: { events: big, resumeAt: 0, epoch: RUN } })
    const frames = h.frames()
    expect(frames).toHaveLength(1)
    expect(frames[0]?.type).toBe("replay")
    expect(frames[0]?.type === "replay" ? frames[0].replay.events.length : 0).toBe(3000)
  })
})

describe("补发与运行代号", () => {
  it("**补发走 catchup 而不是 events**——客户端在 catching 下只认前者", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2), ev(3)])
    send(h, { type: "resync", after: 1, epoch: RUN })
    const frame = h.frames()[0]
    expect(frame?.type).toBe("catchup")
    expect(frame?.type === "catchup" ? frame.sealed.map((s) => s.seq) : []).toEqual([2, 3])
  })

  it("补不了就明说 reset，绝不发一个不完整的片段", () => {
    const h = harness()
    h.ledger.seal([ev(1)])
    send(h, { type: "resync", after: 1, epoch: "别的运行" })
    expect(h.frames()[0]?.type).toBe("reset")
  })

  it("**代号对不上的 hello 一律转全量**——那个游标属于上一次运行", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2)])
    send(h, { type: "hello", after: 1, epoch: "上一次运行" })
    expect(h.replays()).toBe(1)
  })

  it("只报序号不报代号，也当没带", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2)])
    send(h, { type: "hello", after: 1 })
    expect(h.replays()).toBe(1)
  })

  it("resync 不重新 join 账本——那会把确认位打回 0", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2)])
    send(h, { type: "hello" })
    send(h, { type: "ack", seq: 2 })
    send(h, { type: "resync", after: 2, epoch: RUN })
    expect(h.ledger.stats().acked["c1"]).toBe(2)
  })
})

describe("没照着做的都要说一声", () => {
  it("认不出的命令回一条 notice", () => {
    const h = harness()
    send(h, { type: "command", command: { type: "rm -rf", threadId: "t" } })
    expect(h.frames().some((f) => f.type === "notice")).toBe(true)
  })

  it("被拒的命令回一条 notice，且不 dispatch", () => {
    const h = harness({ ceiling: "auto-edit", threadTrust: "full" })
    send(h, { type: "command", command: { type: "thread.prompt", threadId: "t", text: "hi" } })
    expect(h.dispatched()).toEqual([])
    const notice = h.frames().find((f) => f.type === "notice")
    expect(notice?.type === "notice" ? notice.text : "").toContain("full")
  })

  it("被钳的命令照样执行，但也回一条 notice", () => {
    const h = harness({ ceiling: "read-only" })
    send(h, { type: "command", command: { type: "thread.create", cwd: "/w", engine: "codex", trust: "full" } })
    expect(h.dispatched()[0]).toMatchObject({ trust: "read-only" })
    expect(h.frames().some((f) => f.type === "notice")).toBe(true)
  })
})
