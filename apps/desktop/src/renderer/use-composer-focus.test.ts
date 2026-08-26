import { describe, expect, it } from "vitest"
import { wantsComposerFocus, type ComposerFocusState } from "./use-composer-focus.js"

describe("输入区焦点所有权", () => {
  const base: ComposerFocusState = {
    detached: false,
    initial: false,
    wasDetached: false,
    prefillAt: 0,
    seenPrefillAt: 0,
  }
  const cases = [
    ["新会话直接准备输入", { initial: true }, true],
    ["恢复历史后继续输入", { wasDetached: true }, true],
    ["改一改再发的预填内容准备编辑", { prefillAt: 2, seenPrefillAt: 1 }, true],
    ["普通切换旧会话保留侧栏焦点", {}, false],
    ["历史记录即使收到预填也不能聚焦禁用输入框", { detached: true, prefillAt: 2 }, false],
  ] as const
  for (const [name, patch, expected] of cases) {
    it(name, () => {
      expect(wantsComposerFocus({ ...base, ...patch })).toBe(expected)
    })
  }
})
