import { describe, expect, it } from "vitest"
import { stickAfterScroll } from "./useStickToBottom.js"

describe("一次滚动之后还跟不跟着底", () => {
  // 内容 2000、可视 500：底在 1500
  const view = (top: number, height = 2000): { top: number; height: number; client: number } => ({ top, height, client: 500 })
  const cases: readonly { name: string; stuck: boolean; last: number; now: ReturnType<typeof view>; want: boolean }[] = [
    { name: "跟着的时候慢慢往上翻 20px：立刻松手（离底还不到 80px 也算）", stuck: true, last: 1500, now: view(1480), want: false },
    { name: "内容变矮把位置挤下来、人还在底上：不算往上翻", stuck: true, last: 1500, now: view(1400, 1900), want: true },
    { name: "往下滚回离底 80px 以内：重新跟", stuck: false, last: 1000, now: view(1430), want: true },
    { name: "「回到底部」平滑滚动的中途帧（往下走、离底还远）：维持跟随", stuck: true, last: 0, now: view(700), want: true },
    { name: "没跟着、往下滚但离底还远：照旧不跟", stuck: false, last: 300, now: view(700), want: false },
    { name: "跟随自己滚到底那一下：照旧跟", stuck: true, last: 1300, now: view(1500), want: true },
  ]
  for (const one of cases) {
    it(one.name, () => {
      expect(stickAfterScroll(one.stuck, one.last, one.now)).toBe(one.want)
    })
  }
})
