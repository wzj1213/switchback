import { describe, expect, it } from "vitest"
import { tabDestination } from "./useModalKeys.js"

describe("模态 Tab 焦点闭环", () => {
  const cases: readonly [string, number, number, boolean, number | undefined][] = [
    ["容器向前进入首项", -1, 3, false, 0],
    ["容器向后进入末项", -1, 3, true, 2],
    ["首项向后绕到末项", 0, 3, true, 2],
    ["末项向前绕到首项", 2, 3, false, 0],
    ["中间向前交给浏览器", 1, 3, false, undefined],
    ["中间向后交给浏览器", 1, 3, true, undefined],
    ["没有可聚焦项时留给容器", -1, 0, false, undefined],
  ]
  for (const [name, active, total, backwards, expected] of cases) {
    it(name, () => {
      expect(tabDestination(active, total, backwards)).toBe(expected)
    })
  }
})
