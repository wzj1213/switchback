import { describe, expect, it } from "vitest"
import { createLedger, createReassembler, type ServerFrame } from "@switchback/wire"
import { createCalls, type CallOutcome } from "./session-calls.js"
import { createSession } from "./session.js"

/** 让 `.then` 链跑完。 */
const settle = async (): Promise<void> => {
  await new Promise((resume) => setTimeout(resume, 0))
}

function calls(call?: (method: string, arg: unknown) => Promise<CallOutcome>) {
  const written: ServerFrame[] = []
  const logs: string[] = []
  const it = createCalls({
    ...(call === undefined ? {} : { call }),
    write: (frame) => written.push(frame),
    log: (_level, message) => logs.push(message),
  })
  return { it, written, logs }
}

describe("调用：配对与回话", () => {
  const cases: readonly {
    label: string
    frame: Record<string, unknown>
    call?: (method: string, arg: unknown) => Promise<CallOutcome>
    expected: ServerFrame | undefined
  }[] = [
    {
      label: "做成了就按 id 回值",
      frame: { id: 7, method: "switchback:worksite", arg: { cwd: "/w" } },
      call: (method, arg) => Promise.resolve({ ok: true, value: { method, arg } }),
      expected: { type: "result", id: 7, ok: true, value: { method: "switchback:worksite", arg: { cwd: "/w" } } },
    },
    {
      label: "被判拒的原话带回去",
      frame: { id: 1, method: "switchback:selfUpdate" },
      call: () => Promise.resolve({ ok: false, reason: "只能在那台机器上做" }),
      expected: { type: "result", id: 1, ok: false, reason: "只能在那台机器上做" },
    },
    {
      label: "**处理函数抛了也回话**——不让调用方干等到超时",
      frame: { id: 2, method: "switchback:activity" },
      call: () => Promise.reject(new Error("journal 读不动")),
      expected: { type: "result", id: 2, ok: false, reason: "journal 读不动" },
    },
    {
      label: "抛出来的不是 Error 时给一句人话，不把对象原样吐出去",
      frame: { id: 3, method: "switchback:activity" },
      call: () => Promise.reject(new Error("")),
      expected: { type: "result", id: 3, ok: false, reason: "宿主执行这一条时出错了" },
    },
    {
      label: "没写通道名 → 说清楚，不去调",
      frame: { id: 4 },
      call: () => Promise.resolve({ ok: true }),
      expected: { type: "result", id: 4, ok: false, reason: "调用没写要调哪条通道" },
    },
    {
      label: "**这条连接不支持调用时也回话**，不是静默丢掉",
      frame: { id: 5, method: "switchback:worksite" },
      expected: { type: "result", id: 5, ok: false, reason: "这条连接不支持调用宿主通道" },
    },
    {
      label: "id 不是安全整数就回不了话：丢掉并记一笔",
      frame: { id: "7", method: "switchback:worksite" },
      call: () => Promise.resolve({ ok: true }),
      expected: undefined,
    },
  ]
  for (const one of cases) {
    it(one.label, async () => {
      const h = calls(one.call)
      h.it.receive({ type: "call", ...one.frame } as never)
      await settle()
      expect(h.written[0]).toEqual(one.expected)
      if (one.expected === undefined) expect(h.logs.join("")).toContain("没有合法 id")
    })
  }
})

describe("调用：限流", () => {
  it("**同时在途超过 16 条，多出来的当场回拒**——一台失控的设备不能拖垮宿主上的引擎", async () => {
    const pending: (() => void)[] = []
    const h = calls(
      () =>
        new Promise<CallOutcome>((done) => {
          pending.push(() => {
            done({ ok: true })
          })
        }),
    )
    for (let id = 1; id <= 17; id += 1) h.it.receive({ type: "call", id, method: "switchback:activity" })
    await settle()
    expect(h.written).toEqual([{ type: "result", id: 17, ok: false, reason: "同时在途的调用超过 16 条，这一条没有执行" }])
    // 回完一条就腾出一个位子
    pending[0]?.()
    await settle()
    h.it.receive({ type: "call", id: 18, method: "switchback:activity" })
    await settle()
    expect(h.written.filter((f) => f.type === "result" && f.ok === false)).toHaveLength(1)
  })
})

describe("调用：接在一条真连接上", () => {
  function session(call: (method: string, arg: unknown) => Promise<CallOutcome>) {
    const wire: string[] = []
    const s = createSession({
      id: "c1",
      send: (text) => wire.push(text),
      close: () => undefined,
      buffered: () => 0,
      ledger: createLedger("run", 10),
      dispatch: () => undefined,
      replay: async () => undefined,
      ceiling: () => "full",
      trustOf: () => undefined,
      history: async () => ({ events: [], trimmed: false }),
      call,
      log: () => undefined,
    })
    const frames = (): ServerFrame[] => {
      const reassembler = createReassembler()
      return wire.flatMap((text) => {
        const seen = reassembler.observe(text)
        return seen.kind === "frame" ? [seen.frame] : []
      })
    }
    return { s, frames }
  }

  it("线上的 call 帧走到 `call`，回话是一条 result", async () => {
    const h = session((method) => Promise.resolve({ ok: true, value: method }))
    h.s.receive(JSON.stringify({ type: "call", id: 1, method: "switchback:appInfo" }))
    await settle()
    expect(h.frames()).toEqual([{ type: "result", id: 1, ok: true, value: "switchback:appInfo" }])
  })

  it("**结果大到传不了时只让这一条失败，不发 reset**——一份打不开的补丁不该换来一次全量重建", async () => {
    const huge = "x".repeat(16 * 1024 * 1024 + 1)
    const h = session(() => Promise.resolve({ ok: true, value: huge }))
    h.s.receive(JSON.stringify({ type: "call", id: 9, method: "switchback:workPatch" }))
    await settle()
    const frames = h.frames()
    expect(frames.map((f) => f.type)).toEqual(["result"])
    expect(frames[0]).toMatchObject({ type: "result", id: 9, ok: false })
  })
})
