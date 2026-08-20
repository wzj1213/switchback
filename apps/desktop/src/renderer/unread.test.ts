import { describe, expect, it } from "vitest"
import type { ThreadStatus } from "@omni/protocol"
import { stepUnread, type UnreadStep } from "./unread.js"

const step = (over: Partial<UnreadStep>): UnreadStep => ({
  was: new Map(),
  now: [],
  selected: undefined,
  unread: new Set(),
  ...over,
})

const rows = (...pairs: [string, ThreadStatus][]): { id: string; status: ThreadStatus }[] =>
  pairs.map(([id, status]) => ({ id, status }))

describe("后台跑完的那条要亮起来", () => {
  const cases: {
    name: string
    input: UnreadStep
    want: string[]
  }[] = [
    {
      name: "跑着 → 空闲，而你看的是别条：亮",
      input: step({ was: new Map([["a", "running"]]), now: rows(["a", "idle"]), selected: "b" }),
      want: ["a"],
    },
    {
      name: "待批 → 空闲（中断掉的那种）也算跑完",
      input: step({ was: new Map([["a", "waiting_approval"]]), now: rows(["a", "idle"]) }),
      want: ["a"],
    },
    {
      name: "你正看着它跑完：不亮——那是你亲眼看着的",
      input: step({ was: new Map([["a", "running"]]), now: rows(["a", "idle"]), selected: "a" }),
      want: [],
    },
    {
      name: "跑挂了不亮：那一行已经写着红色的「失败」",
      input: step({ was: new Map([["a", "running"]]), now: rows(["a", "failed"]) }),
      want: [],
    },
    {
      name: "启动中 → 空闲不算跑完：引擎起好了而已，什么都没发生",
      input: step({ was: new Map([["a", "starting"]]), now: rows(["a", "idle"]) }),
      want: [],
    },
    {
      name: "冷启动（上一帧什么都不知道）不凭空点亮一片",
      input: step({ now: rows(["a", "idle"], ["b", "idle"]) }),
      want: [],
    },
    {
      name: "点开就算看过",
      input: step({ now: rows(["a", "idle"]), unread: new Set(["a"]), selected: "a" }),
      want: [],
    },
    {
      name: "没点开就一直亮着——切走再切回来它还在",
      input: step({ now: rows(["a", "idle"]), unread: new Set(["a"]), selected: "b" }),
      want: ["a"],
    },
    {
      name: "亮着的时候又跑起来了：旗子留着，点开才算看过",
      input: step({ now: rows(["a", "running"]), unread: new Set(["a"]) }),
      want: ["a"],
    },
    {
      name: "会话删了就跟着没了，不留一个永远点不掉的未读",
      input: step({ now: rows(["b", "idle"]), unread: new Set(["a"]) }),
      want: [],
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect([...stepUnread(c.input).unread].sort()).toEqual(c.want)
    })
  }

  it("没变化时把原来那个集合原样还回去——换一个新引用就是一个 setState 死循环", () => {
    const unread = new Set(["a"])
    const input = step({ now: rows(["a", "idle"]), unread, was: new Map([["a", "idle"]]) })
    expect(stepUnread(input).unread).toBe(unread)
  })

  it("记下这一帧的状态，下一帧才判得出翻面", () => {
    const next = stepUnread(step({ now: rows(["a", "running"]) }))
    expect(next.was.get("a")).toBe("running")
    expect([...stepUnread(step({ was: next.was, now: rows(["a", "idle"]) })).unread]).toEqual(["a"])
  })
})
