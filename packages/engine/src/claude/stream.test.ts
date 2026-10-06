import { describe, expect, it } from "vitest"
import type { Event, ItemId } from "@switchback/protocol"
import { createStream, onStreamEvent, resetStream, type RawStreamEvent } from "./stream.js"

function rig(): { events: Event[]; feed: (...raw: readonly RawStreamEvent[]) => void; ids: () => string[] } {
  const events: Event[] = []
  const state = createStream()
  let seq = 0
  const ctx = {
    turnId: "t1",
    at: 7,
    nextId: (): ItemId => `t1:i${String(++seq)}`,
    emit: (event: Event) => events.push(event),
  }
  return {
    events,
    feed: (...raw) => {
      for (const one of raw) onStreamEvent(state, one, ctx)
    },
    ids: () => [...state.byOrder.values()],
  }
}

const start = (index: number, type: string): RawStreamEvent => ({
  type: "content_block_start",
  index,
  content_block: { type },
})
const delta = (index: number, text: string): RawStreamEvent => ({
  type: "content_block_delta",
  index,
  delta: { type: "text_delta", text },
})

describe("逐字那一路", () => {
  it("第一条 delta 才把 item 建出来，而且**建成空的**", () => {
    const r = rig()
    r.feed(start(0, "text"), delta(0, "你好"))
    expect(r.events).toEqual([
      { type: "item.started", at: 7, item: { id: "t1:i1", turnId: "t1", at: 7, kind: "agent_message", text: "", complete: false } },
      { type: "item.delta", at: 7, itemId: "t1:i1", append: "你好" },
    ])
  })

  it("**不把第一段文字塞进 `item.started`**：塞进去的那段流速表就漏计了", () => {
    const r = rig()
    r.feed(start(0, "text"), delta(0, "甲"), delta(0, "乙"))
    const said = r.events.filter((e) => e.type === "item.delta").map((e) => (e.type === "item.delta" ? e.append : ""))
    expect(said.join("")).toBe("甲乙")
  })

  it("一个字都没吐的块不留下空消息——`content_block_start` 单独来时什么都不发", () => {
    const r = rig()
    r.feed(start(0, "text"), { type: "content_block_stop", index: 0 })
    expect(r.events).toEqual([])
  })

  it("思考块走 reasoning", () => {
    const r = rig()
    r.feed(start(0, "thinking"), { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "嗯" } })
    expect(r.events[0]).toMatchObject({ item: { kind: "reasoning" } })
  })

  it("工具调用不走这条路：它的 id 要复用 Claude 自己的，入参也得拼全才有意义", () => {
    const r = rig()
    r.feed(
      start(0, "tool_use"),
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":' } } as RawStreamEvent,
    )
    expect(r.events).toEqual([])
  })

  it("**序号按「第几个说出来的块」排**，工具块夹在中间也不打乱", () => {
    const r = rig()
    r.feed(start(0, "text"), delta(0, "甲"))
    r.feed(start(1, "tool_use"))
    r.feed(start(2, "text"), delta(2, "乙"))
    // 两个说出来的块拿到 0 和 1 两个序号——收尾那条消息就是按这个对齐的
    expect(r.ids()).toEqual(["t1:i1", "t1:i2"])
  })

  it("换一条消息就清空：一轮里工具往返之后还会再来一条", () => {
    const r = rig()
    r.feed(start(0, "text"), delta(0, "第一条"))
    r.feed({ type: "message_start" })
    r.feed(start(0, "text"), delta(0, "第二条"))
    // 第二条重新从序号 0 起，不接着第一条数
    expect(r.ids()).toEqual(["t1:i2"])
  })

  it("认不出的形状一律什么都不做", () => {
    const r = rig()
    r.feed({ type: "message_delta" }, { type: "ping" }, {}, delta(9, "没人认领"))
    expect(r.events).toEqual([])
  })
})

describe("resetStream", () => {
  it("清干净：序号、两张表都回到出厂", () => {
    const state = createStream()
    onStreamEvent(state, start(0, "text"), {
      turnId: "t1",
      at: 1,
      nextId: () => "x",
      emit: () => undefined,
    })
    expect(state.said).toBe(1)
    resetStream(state)
    expect(state.said).toBe(0)
    expect(state.byIndex.size).toBe(0)
    expect(state.byOrder.size).toBe(0)
    expect(state.kindAt.size).toBe(0)
  })
})
