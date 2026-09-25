import { describe, expect, it } from "vitest"
import { selectsOnPress, type PressLike } from "./press.js"

describe("按下即选中的判据", () => {
  const plain: PressLike = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
  const cases = [
    ["主键按下", {}, true],
    ["右键留给菜单", { button: 2 }, false],
    ["中键不切换", { button: 1 }, false],
    ["⌘ 点不抢先", { metaKey: true }, false],
    ["⌃ 点是右键菜单", { ctrlKey: true }, false],
    ["⇧ 点不抢先", { shiftKey: true }, false],
    ["⌥ 点不抢先", { altKey: true }, false],
  ] as const
  for (const [name, patch, expected] of cases) {
    it(name, () => {
      expect(selectsOnPress({ ...plain, ...patch })).toBe(expected)
    })
  }
})
