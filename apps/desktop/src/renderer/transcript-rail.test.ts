import { describe, expect, it } from "vitest"
import { railLayout, railPeek } from "./transcript-rail.js"

const points = [
  { id: "a", text: "第一件事", top: 0 },
  { id: "b", text: "第二件事", top: 500 },
  { id: "c", text: "第三件事", top: 1800 },
]
const box = { scrollHeight: 2000, clientHeight: 800, scrollTop: 0 }

describe("导航条的几何", () => {
  it("滚不动就整条不画——那时候「我在哪儿」不是个问题", () => {
    const cases = [
      // 内容只比可视区高一点点
      [{ scrollHeight: 880, clientHeight: 800, scrollTop: 0 }, "刚好差 80，不到门槛"],
      [{ scrollHeight: 800, clientHeight: 800, scrollTop: 0 }, "一屏装得下"],
      [{ scrollHeight: 0, clientHeight: 0, scrollTop: 0 }, "还没量出来"],
    ] as const
    for (const [size, why] of cases) {
      expect(railLayout(points, size).marks, why).toEqual([])
    }
    // 只有一次提问也不画：一格导航到它自己
    expect(railLayout(points.slice(0, 1), box).marks).toEqual([])
  })

  it("每格按它在整条会话里的深浅摆，上下各留边", () => {
    const { marks } = railLayout(points, box)
    expect(marks.map((m) => m.y)).toEqual([10, 205, 712])
    // 都落在留边之内
    for (const mark of marks) {
      expect(mark.y).toBeGreaterThanOrEqual(10)
      expect(mark.y).toBeLessThanOrEqual(box.clientHeight - 10)
    }
  })

  it("当下那一格跟着视线走，滚到底时一定是最后一格", () => {
    expect(railLayout(points, box).activeId).toBe("a")
    // 视线（顶边下方两成）刚过第二个落点
    expect(railLayout(points, { ...box, scrollTop: 400 }).activeId).toBe("b")
    // 滚到底：最后一屏里 b 和 c 都在，得是 c
    expect(railLayout(points, { ...box, scrollTop: 1200 }).activeId).toBe("c")
  })

  it("悬停卡第一行当标题，其余压成一段", () => {
    expect(railPeek("push 到 release 分支上吧\n\n先确认远端的情况，\n再决定推送方式")).toEqual({
      title: "push 到 release 分支上吧",
      body: "先确认远端的情况， 再决定推送方式",
    })
    expect(railPeek("只有一行")).toEqual({ title: "只有一行", body: "" })
    expect(railPeek("   ")).toEqual({ title: "", body: "" })
  })
})
