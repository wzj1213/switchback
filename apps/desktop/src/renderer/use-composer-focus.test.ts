import { describe, expect, it } from "vitest"
import { wantsComposerFocus, type ComposerFocusState } from "./use-composer-focus.js"

describe("输入区焦点所有权", () => {
  const base: ComposerFocusState = {
    initial: false,
    prefillAt: 0,
    seenPrefillAt: 0,
  }
  const cases = [
    ["新会话直接准备输入", { initial: true }, true],
    ["改一改再发的预填内容准备编辑（历史会话也一样，它能发）", { prefillAt: 2, seenPrefillAt: 1 }, true],
    ["普通切换旧会话保留侧栏焦点", {}, false],
  ] as const
  for (const [name, patch, expected] of cases) {
    it(name, () => {
      expect(wantsComposerFocus({ ...base, ...patch })).toBe(expected)
    })
  }
})
