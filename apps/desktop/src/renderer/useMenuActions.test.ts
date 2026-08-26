import { describe, expect, it } from "vitest"
import { isReviewKey } from "./useMenuActions.js"

describe("审核快捷键", () => {
  it("只接受 Shift + Command/Control + R", () => {
    const cases = [
      [{ key: "r", metaKey: true, ctrlKey: false, shiftKey: true }, true],
      [{ key: "R", metaKey: false, ctrlKey: true, shiftKey: true }, true],
      [{ key: "r", metaKey: true, ctrlKey: false, shiftKey: false }, false],
      [{ key: "d", metaKey: true, ctrlKey: false, shiftKey: true }, false],
    ] as const
    for (const [event, expected] of cases) expect(isReviewKey(event)).toBe(expected)
  })
})
