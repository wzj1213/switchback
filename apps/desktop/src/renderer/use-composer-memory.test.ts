import { describe, expect, it } from "vitest"
import { imageAttachmentsEnabled } from "./use-composer-memory.js"

describe("输入区图片分流", () => {
  const cases: readonly [canAttach: boolean, aside: boolean, expected: boolean][] = [
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ]

  for (const [canAttach, aside, expected] of cases) {
    it(`引擎附件=${String(canAttach)} · 侧问=${String(aside)} → ${String(expected)}`, () => {
      expect(imageAttachmentsEnabled(canAttach, aside)).toBe(expected)
    })
  }
})
