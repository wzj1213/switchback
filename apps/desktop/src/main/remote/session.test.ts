import { describe, expect, it } from "vitest"
import type { Command, Event, Trust } from "@switchback/protocol"
import { createLedger, createReassembler, type ServerFrame } from "@switchback/wire"
import { createSession } from "./session.js"
import type { Sink } from "../sink.js"

const RUN = "run-a"

/**
 * 让 `load()` 那条不等的 promise 链跑完。
 *
 * 用宏任务而不是数几个微任务：那条链现在要先等基线（`State.baseline`），
 * 中间隔着 `replay()` 自己的 promise，数微任务的写法会随实现改动而碎。
 */
const settle = async (): Promise<void> => {
  await new Promise((resume) => setTimeout(resume, 0))
  await new Promise((resume) => setTimeout(resume, 0))
}

const ev = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: String(n) })

interface Harness {
  session: ReturnType<typeof createSession>
  ledger: ReturnType<typeof createLedger>
  /** 客户端那侧收到的帧（已经过重组）。 */
  frames: () => readonly ServerFrame[]
  dispatched: () => readonly Command[]
  /** 补正文时读过哪几条会话的记录。 */
  reads: () => readonly string[]
  replays: () => number
  closed: () => { code: number; reason: string } | undefined
  logs: () => readonly string[]
  buffer: (bytes: number) => void
}

interface Options {
  ceiling?: Trust
  replayFails?: boolean
  threadTrust?: Trust
  history?: readonly Event[]
  historyFails?: boolean
  /** 这条会话的正文被裁过。 */
  trimmed?: boolean
  /** 全量里带了正文的会话。 */
  bodies?: readonly string[]
}

function harness(options: Options = {}): Harness {
  const ledger = createLedger(RUN, 100)
  const wire: string[] = []
  const dispatched: Command[] = []
  const logs: string[] = []
  const reads: string[] = []
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
    replay: async (sink: Sink) => {
      state.replays += 1
      if (options.replayFails === true) throw new Error("磁盘炸了")
      // 真宿主是读完磁盘才发；这里照样走一遍 sink，`bodies` 的语义才对得上
      sink.send({ channel: "switchback:replay", replay: { events: [], resumeAt: 0, epoch: RUN, bodies: options.bodies ?? [] } })
    },
    ceiling: () => options.ceiling ?? "full",
    trustOf: () => options.threadTrust,
    history: async (threadId) => {
      reads.push(threadId)
      if (options.historyFails === true) throw new Error("磁盘炸了")
      return { events: options.history ?? [], trimmed: options.trimmed === true }
    },
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
    reads: () => reads,
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

  it("**打开一条正文不在全量里的会话，补一份 thread 帧**——分级 replay 的另一半", async () => {
    const h = harness({ history: [ev(1), ev(2)] })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.frames().filter((f) => f.type === "thread")).toEqual([
      { type: "thread", threadId: "t-1", events: [ev(1), ev(2)] },
    ])
  })

  it("**全量里已经带了正文的那些不再补**——否则你打开的第一条必然多读一次磁盘", async () => {
    const h = harness({ history: [ev(1)] })
    h.session.sink.send({ channel: "switchback:replay", replay: { events: [], resumeAt: 0, epoch: RUN, bodies: ["t-1"] } })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.reads()).toEqual([])
  })

  it("`bodies` 缺省 = 全都带，一条都不补——那是同机 IPC 那条路的语义", async () => {
    const h = harness({ history: [ev(1)] })
    h.session.sink.send({ channel: "switchback:replay", replay: { events: [], resumeAt: 0, epoch: RUN } })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.reads()).toEqual(["t-1"])
  })

  it("**同一条只补一次**——来回切会话不该每次都读一遍磁盘", async () => {
    const h = harness({ history: [ev(1)] })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    send(h, { type: "watch", threadId: "t-2" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.reads()).toEqual(["t-1", "t-2"])
  })

  it("**记录为空也发 thread 帧**——客户端据此结束加载并明确显示空会话", async () => {
    const h = harness({ history: [] })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.frames().filter((f) => f.type === "thread")).toEqual([
      { type: "thread", threadId: "t-1", events: [] },
    ])
  })

  it("**读磁盘炸了不断连接，而且标记要撤掉**——退出去再进来还能再试一次", async () => {
    const h = harness({ historyFails: true })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.closed()).toBeUndefined()
    expect(h.logs().some((l) => l.includes("补 t-1 的正文失败"))).toBe(true)
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.reads()).toEqual(["t-1", "t-1"])
  })

  it("watch null 不去读磁盘", async () => {
    const h = harness({ history: [ev(1)] })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: null })
    await settle()
    expect(h.reads()).toEqual([])
  })

  it("**`watch` 抢在全量前面时，补正文要等**——先到的 thread 帧会被随后的全量抹掉", async () => {
    const h = harness({ history: [ev(1)] })
    // 客户端重连的真实顺序：hello 和 watch 几乎同时，而两条在宿主这侧都要读磁盘
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.frames()).toEqual([])
    // 全量出门之后才轮到它
    send(h, { type: "hello" })
    await settle()
    const kinds = h.frames().map((f) => f.type)
    expect(kinds).toEqual(["replay", "thread"])
  })

  it("**续上的那条路没有全量，闸也要开**——否则补正文永远等一份不会来的东西", async () => {
    const h = harness({ history: [ev(1)] })
    h.ledger.seal([ev(1)])
    send(h, { type: "watch", threadId: "t-1" })
    send(h, { type: "hello", after: 1, epoch: RUN })
    await settle()
    expect(h.frames().some((f) => f.type === "thread")).toBe(true)
  })

  it("全量重建失败也要开闸，别把补正文永久卡住", async () => {
    const h = harness({ replayFails: true, history: [ev(1)] })
    send(h, { type: "watch", threadId: "t-1" })
    send(h, { type: "hello" })
    await settle()
    await settle()
    expect(h.frames().some((f) => f.type === "reset")).toBe(true)
    expect(h.frames().some((f) => f.type === "thread")).toBe(true)
  })

  it("**换一份全量要把已发过的勾清掉**——新那份的 bodies 可能换了人", async () => {
    const h = harness({ history: [ev(1)], bodies: ["t-1"] })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.reads()).toEqual([])
    // 第二份全量不再带 t-1 的正文
    h.session.sink.send({ channel: "switchback:replay", replay: { events: [], resumeAt: 0, epoch: RUN, bodies: [] } })
    send(h, { type: "watch", threadId: "t-2" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.reads()).toEqual(["t-2", "t-1"])
  })

  it("等基线那会儿连接断了就别写了", async () => {
    const h = harness({ history: [ev(1)] })
    send(h, { type: "watch", threadId: "t-1" })
    h.session.stop()
    send(h, { type: "hello" })
    await settle()
    expect(h.frames().some((f) => f.type === "thread")).toBe(false)
  })

  it("**补发太大就让它走全量**——反复要同一帧是个不会自己好的死循环", () => {
    const h = harness()
    // **少而大**：这个 harness 的账本只留 100 条，条数超了会先撞上「缺口太老」那条路。
    // 50 条 × 8K 码元 ≈ 400K，超过补发那道 192K 的闸
    const fat = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: "验收".repeat(4000) })
    for (let i = 1; i <= 50; i += 1) h.ledger.seal([fat(i)])
    send(h, { type: "resync", after: 1, epoch: RUN })
    const kinds = h.frames().map((f) => f.type)
    expect(kinds).toEqual(["reset"])
    expect(h.logs().some((l) => l.includes("太大补不动"))).toBe(true)
  })

  it("补得动的照常补", () => {
    const h = harness()
    h.ledger.seal([ev(1), ev(2), ev(3)])
    send(h, { type: "resync", after: 1, epoch: RUN })
    expect(h.frames().map((f) => f.type)).toEqual(["catchup"])
  })

  it("**握手时那条续上的路也要有同一道闸**——两条路补的是同一段东西", () => {
    const h = harness()
    const fat = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: "验收".repeat(4000) })
    for (let i = 1; i <= 50; i += 1) h.ledger.seal([fat(i)])
    send(h, { type: "hello", after: 1, epoch: RUN })
    // 补不动 → 转全量重建，而全量那条已经按大小封了顶
    expect(h.replays()).toBe(1)
  })

  it("**正文被裁了要说出来**——不说的话那条会话看起来是从中间开始的，而人会以为记录丢了", async () => {
    const h = harness({ history: [ev(1)], trimmed: true })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.frames().find((f) => f.type === "thread")).toMatchObject({ trimmed: true })
  })

  it("没裁就不带这个字段——省得客户端画一条不该有的分隔线", async () => {
    const h = harness({ history: [ev(1)] })
    send(h, { type: "hello" })
    send(h, { type: "watch", threadId: "t-1" })
    await settle()
    expect(h.frames().find((f) => f.type === "thread")).not.toHaveProperty("trimmed")
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
    h.session.sink.send({ channel: "switchback:replay", replay: { events: big, resumeAt: 0, epoch: RUN } })
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
    // 被拒的是一句话：原样还给手机的输入框，人不用凭记忆重打
    expect(notice).toMatchObject({ returned: { threadId: "t", text: "hi" } })
  })

  it("被拒的不是一句话：没有东西要还", () => {
    const h = harness({ ceiling: "auto-edit", threadTrust: "full" })
    send(h, { type: "command", command: { type: "thread.fork", threadId: "t", to: "codex" } })
    const notice = h.frames().find((f) => f.type === "notice")
    expect(notice).toBeDefined()
    expect(notice !== undefined && "returned" in notice).toBe(false)
  })

  it("被钳的命令照样执行，但也回一条 notice", () => {
    const h = harness({ ceiling: "read-only" })
    send(h, { type: "command", command: { type: "thread.create", cwd: "/w", engine: "codex", trust: "full" } })
    expect(h.dispatched()[0]).toMatchObject({ trust: "read-only" })
    expect(h.frames().some((f) => f.type === "notice")).toBe(true)
  })
})
