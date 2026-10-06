import { describe, expect, it } from "vitest"
import type { EngineStatus, Event } from "@switchback/protocol"
import { reduceAll } from "./reduce.js"
import { initial, reconnectingOf } from "./state.js"

const status = (s: EngineStatus, at: number, detail?: string, threadId = "a"): Event => ({
  type: "engine.status", at, threadId, status: s, ...(detail === undefined ? {} : { detail }),
})

describe("正在重连：记在旁边，不进横幅", () => {
  const cases: readonly { name: string; events: readonly Event[]; want: { since: number; detail?: string } | undefined }[] = [
    { name: "断了", events: [status("reconnecting", 5, "连接断了")], want: { since: 5, detail: "连接断了" } },
    { name: "再报一次：起点不变、说明换新", events: [status("reconnecting", 5, "一"), status("reconnecting", 9, "二")], want: { since: 5, detail: "二" } },
    { name: "接回来了", events: [status("reconnecting", 5), status("ready", 7)], want: undefined },
    { name: "接不回来：交给横幅", events: [status("reconnecting", 5), status("crashed", 9, "接不上")], want: undefined },
    { name: "别的会话的状态不收它", events: [status("reconnecting", 5), status("ready", 7, undefined, "b")], want: { since: 5 } },
    { name: "删会话一起清", events: [status("reconnecting", 5), { type: "thread.removed", at: 6, threadId: "a" }], want: undefined },
  ]
  for (const one of cases) {
    it(one.name, () => expect(reconnectingOf(reduceAll(initial(), one.events), "a")).toEqual(one.want))
  }

  it("不弹横幅；没有会话归属的也不记", () => {
    const s = reduceAll(initial(), [status("reconnecting", 5, "x"), status("reconnecting", 6, "y", "")])
    expect(s.notices).toEqual([])
    expect(s.reconnecting).toEqual({ a: { since: 5, detail: "x" } })
  })
})

describe("接连报的同一件事合成一条", () => {
  const cases: readonly { name: string; events: readonly Event[]; want: readonly [string, number | undefined][] }[] = [
    { name: "同一句话连报三次", events: [status("crashed", 1, "断了"), status("crashed", 2, "断了"), status("crashed", 3, "断了")], want: [["断了", 3]] },
    { name: "中间夹了别的就不合", events: [status("crashed", 1, "断了"), status("crashed", 2, "别的"), status("crashed", 3, "断了")], want: [["断了", undefined], ["别的", undefined], ["断了", undefined]] },
    { name: "换了会话不合", events: [status("crashed", 1, "断了"), status("crashed", 2, "断了", "b")], want: [["断了", undefined], ["断了", undefined]] },
    { name: "换了类别不合", events: [status("crashed", 1, "断了"), status("degraded", 2, "断了")], want: [["断了", undefined], ["断了", undefined]] },
  ]
  for (const one of cases) {
    it(one.name, () => {
      const s = reduceAll(initial(), one.events)
      expect(s.notices.map((n) => [n.text, n.count] as const)).toEqual(one.want)
    })
  }

  it("合成的那条拿新 id 和新时刻——界面据此重新亮出来，而不是悄悄改个数字", () => {
    const s = reduceAll(initial(), [status("crashed", 1, "断了"), status("crashed", 2, "断了")])
    expect(s.notices).toEqual([expect.objectContaining({ id: "n2", at: 2, count: 2 })])
  })
})
