import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { isAttending, watchTurns } from "./attention.js"

const windowOf = (focused: boolean, destroyed = false): {
  isDestroyed: () => boolean
  isFocused: () => boolean
} => ({
  isDestroyed: () => destroyed,
  isFocused: () => focused,
})

describe("系统通知是不是已经在人眼前", () => {
  it("只在窗口聚焦且正在看同一条会话时抑制", () => {
    const cases = [
      { name: "失焦", windows: [windowOf(false)], viewing: "th-1", event: "th-1", want: false },
      { name: "已销毁", windows: [windowOf(true, true)], viewing: "th-1", event: "th-1", want: false },
      { name: "启动首帧未知", windows: [windowOf(true)], viewing: undefined, event: "th-1", want: true },
      { name: "正在看它", windows: [windowOf(true)], viewing: "th-1", event: "th-1", want: true },
      { name: "正在看别处", windows: [windowOf(true)], viewing: "th-2", event: "th-1", want: false },
      { name: "审批归属未知", windows: [windowOf(true)], viewing: "th-2", event: "", want: true },
    ] as const

    for (const c of cases) {
      expect(isAttending(c.windows, c.viewing, c.event), c.name).toBe(c.want)
    }
  })
})

/**
 * 「跑完了要不要出声」这件事只有四条规矩，但每一条都是**不出声**的理由——
 * 一个乱响的通知被关掉一次，就再也不会被打开，那时候连审批也叫不动人了。
 */
function rig(now: number): { note: (e: Event) => void; said: string[]; at: (t: number) => void } {
  const said: string[] = []
  const clock = { t: now }
  const turns = watchTurns((threadId, body) => said.push(`${threadId}: ${body}`), () => clock.t)
  return {
    note: turns.note,
    said,
    at: (t) => {
      clock.t = t
    },
  }
}

const started = (turnId: string, threadId: string, at: number): Event => ({
  type: "turn.started",
  at,
  turn: { id: turnId, threadId, engine: "codex", status: "running", startedAt: at },
})

describe("一轮跑完要不要出声", () => {
  it("跑了四分钟：说清楚是哪条会话、用了多久", () => {
    const r = rig(0)
    r.note(started("tn-1", "th-1", 0))
    r.at(252_000)
    r.note({ type: "turn.completed", at: 252_000, turnId: "tn-1", status: "completed" })
    expect(r.said).toEqual(["th-1: 跑完了，用了 4 分 12 秒"])
  })

  it("界面是英文时通知也说英文", () => {
    const said: string[] = []
    const turns = watchTurns((threadId, body) => said.push(`${threadId}: ${body}`), () => 252_000, () => "en")
    turns.note(started("tn-1", "th-1", 0))
    turns.note({ type: "turn.completed", at: 252_000, turnId: "tn-1", status: "completed" })
    expect(said).toEqual(["th-1: Done in 4m 12s"])
  })

  it("**十五秒以内的不出声**——那种你八成还盯着屏幕", () => {
    const r = rig(0)
    r.note(started("tn-1", "th-1", 0))
    r.at(9_000)
    r.note({ type: "turn.completed", at: 9_000, turnId: "tn-1", status: "completed" })
    expect(r.said).toEqual([])
  })

  it("**自己按停的不出声**——那是你刚做的动作，报告它等于回声", () => {
    const r = rig(0)
    r.note(started("tn-1", "th-1", 0))
    r.at(600_000)
    r.note({ type: "turn.completed", at: 600_000, turnId: "tn-1", status: "interrupted" })
    expect(r.said).toEqual([])
  })

  it("跑挂了**不看时长**：三秒就崩同样要说，而且说人话那一句", () => {
    const r = rig(0)
    r.note(started("tn-1", "th-1", 0))
    r.at(3_000)
    r.note({
      type: "turn.completed",
      at: 3_000,
      turnId: "tn-1",
      status: "failed",
      error: `{"error":{"message":"额度用完了"}}`,
    })
    expect(r.said).toEqual(["th-1: 跑挂了：额度用完了"])
  })

  it("没记过开头的收工事件不出声，也不炸——重启后收到上一轮的尾巴就是这样", () => {
    const r = rig(0)
    expect(() => {
      r.note({ type: "turn.completed", at: 1, turnId: "不认识", status: "completed" })
    }).not.toThrow()
    expect(r.said).toEqual([])
  })

  it("同一轮的收工只说一次：记录用完就删", () => {
    const r = rig(0)
    r.note(started("tn-1", "th-1", 0))
    r.at(60_000)
    const done: Event = { type: "turn.completed", at: 60_000, turnId: "tn-1", status: "completed" }
    r.note(done)
    r.note(done)
    expect(r.said).toHaveLength(1)
  })
})
