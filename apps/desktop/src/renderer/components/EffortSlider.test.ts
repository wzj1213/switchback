import { describe, expect, it } from "vitest"
import { indexAt } from "./effort-geometry.js"
import { shownEffort } from "./use-effort-pending.js"

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

describe("shownEffort", () => {
  const efforts = ["low", "medium", "high", "xhigh", "ultracode"] as const
  const cases: readonly [name: string, layers: Parameters<typeof shownEffort>[0], want: string | undefined][] = [
    ["拖动中手指最大", { preview: "ultracode", pending: "high", effort: "low", efforts }, "ultracode"],
    // 这一条就是「点开、拖到 ultracode、马上收起」：条子没了、回声还没到
    ["收起后仍是刚落的那一档，不是引擎那份旧值", { pending: "ultracode", effort: "low", efforts }, "ultracode"],
    ["没有在途落档时听引擎的", { effort: "medium", efforts }, "medium"],
    ["引擎没报就用模型默认", { defaultEffort: "high", efforts }, "high"],
    ["什么都没有时退到清单第一档", { efforts }, "low"],
    ["清单也空就没有值可画", { efforts: [] }, undefined],
  ]
  for (const [name, layers, want] of cases) {
    it(name, () => { expect(shownEffort(layers)).toBe(want) })
  }
})
