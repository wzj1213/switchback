import { describe, expect, it } from "vitest"
import { acceptsCompletion } from "./completion-keys.js"

describe("候选确认键", () => {
  const cases = [
    ["普通回车确认", "Enter", false, false, true],
    ["普通 Tab 确认", "Tab", false, false, true],
    ["Shift+Tab 反向离开", "Tab", true, false, false],
    ["输入法回车留给组合输入", "Enter", false, true, false],
    ["方向键不是确认", "ArrowDown", false, false, false],
  ] as const

  for (const [name, key, shift, composing, expected] of cases) {
    it(name, () => {
      expect(acceptsCompletion(key, shift, composing)).toBe(expected)
    })
  }
})
