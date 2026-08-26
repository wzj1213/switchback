import { describe, expect, it } from "vitest"
import { stablePlacement, type Placement } from "./use-popover-layout.js"

describe("浮层等值定位", () => {
  it("相同坐标保留原对象，真正移动或关闭才换值", () => {
    const at: Placement = { left: 24, top: 80 }
    const cases: readonly {
      name: string
      current: Placement | undefined
      next: Placement | undefined
      same: boolean
    }[] = [
      { name: "等值回报", current: at, next: { left: 24, top: 80 }, same: true },
      { name: "横向移动", current: at, next: { left: 25, top: 80 }, same: false },
      { name: "纵向移动", current: at, next: { left: 24, top: 81 }, same: false },
      { name: "关闭", current: at, next: undefined, same: false },
      { name: "保持关闭", current: undefined, next: undefined, same: true },
    ]
    for (const one of cases) {
      const result = stablePlacement(one.current, one.next)
      expect(result === one.current, one.name).toBe(one.same)
      if (!one.same) expect(result, one.name).toBe(one.next)
    }
  })
})
