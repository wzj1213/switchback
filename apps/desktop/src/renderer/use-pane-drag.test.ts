import { describe, expect, it } from "vitest"
import { paneKeyDelta, paneWidthAt } from "./use-pane-drag.js"

describe("分界线挪多少、栏宽变多少", () => {
  const room = { viewport: 1280, rail: 240 }
  const cases = [
    ["侧栏的线往右是变宽", "rail", 240, 40, 280],
    ["侧栏的线往左是变窄", "rail", 240, -40, 200],
    ["侧栏不低于下限", "rail", 240, -200, 200],
    ["面板的线往左是变宽", "panel", 400, -60, 460],
    ["面板的线往右是变窄", "panel", 400, 60, 340],
    ["面板不挤掉对话", "panel", 400, -600, 1280 - 240 - 420],
  ] as const
  for (const [name, side, start, dx, expected] of cases) {
    it(name, () => { expect(paneWidthAt(side, start, dx, room)).toBe(expected) })
  }
})

describe("方向键一格", () => {
  const cases = [
    ["右键 16", "ArrowRight", false, 16],
    ["左键 -16", "ArrowLeft", false, -16],
    ["⇧ 放大到 64", "ArrowRight", true, 64],
    ["别的键不管", "Enter", false, undefined],
  ] as const
  for (const [name, key, shift, expected] of cases) {
    it(name, () => { expect(paneKeyDelta(key, shift)).toBe(expected) })
  }
})
