import { describe, expect, it, vi } from "vitest"
import { writeClipboard } from "./system-clipboard.js"

describe("系统剪贴板回执", () => {
  const cases = [
    { name: "字符串写入成功", text: "源码", throws: false, expected: true, calls: 1 },
    { name: "拒绝非字符串 IPC", text: 42, throws: false, expected: false, calls: 0 },
    { name: "系统调用异常", text: "源码", throws: true, expected: false, calls: 1 },
  ] as const

  for (const one of cases) {
    it(one.name, () => {
      const writeText = one.throws
        ? vi.fn(() => { throw new Error("clipboard unavailable") })
        : vi.fn()
      expect(writeClipboard({ writeText }, one.text)).toBe(one.expected)
      expect(writeText).toHaveBeenCalledTimes(one.calls)
    })
  }
})
