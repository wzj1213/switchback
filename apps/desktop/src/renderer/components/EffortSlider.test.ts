import { describe, expect, it } from "vitest"
import { indexAt } from "./effort-geometry.js"

describe("indexAt", () => {
  it("指针位置 → 档位序号：贴边、越界、单档、空清单", () => {
    // width=148、THUMB=24、PAD=4：有效行程 116，指针先退 PAD + 半个拇指（16px）
    const cases: readonly [x: number, width: number, count: number, want: number][] = [
      [10, 148, 4, 0], // 贴左沿是第一档
      [52, 148, 4, 1],
      [95, 148, 4, 2],
      [138, 148, 4, 3], // 贴右沿是最后一档
      [0, 148, 4, 0], // 拖出左沿不出负数
      [999, 148, 4, 3], // 拖出右沿不越界
      [60, 148, 1, 0], // 只有一档时永远是它
      [60, 148, 0, 0], // 清单是空也不炸
      [74, 148, 4, 2], // 段中点往上进（(74−16)/116 = 0.5 → 1.5 → 2）
    ]
    for (const [x, width, count, want] of cases) {
      expect(indexAt(x, width, count)).toBe(want)
    }
  })
})
