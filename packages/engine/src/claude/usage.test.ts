import { describe, expect, it } from "vitest"
import { claudeUsage } from "./usage.js"

describe("Claude 用量", () => {
  const cases = [
    {
      name: "控制快照覆盖 result 汇总，窗口不再被一轮里的重复输入顶到 98%",
      raw: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 7 },
      options: { context: { totalTokens: 31, maxTokens: 200 } },
      expected: { contextUsed: 31, contextWindow: 200, outputTokens: 7, cacheRead: 20 },
    },
    {
      name: "旧 CLI 没快照时用最近一次 assistant 请求，不拿 result 汇总冒充占用",
      raw: { input_tokens: 300, cache_read_input_tokens: 600, output_tokens: 90 },
      options: { latest: { input_tokens: 3, cache_read_input_tokens: 6, output_tokens: 2 } },
      expected: { contextUsed: 11, outputTokens: 90, cacheRead: 6 },
    },
    {
      name: "steer 的几段输出合并，但上下文和缓存仍取最后请求",
      raw: { input_tokens: 3, cache_read_input_tokens: 5, output_tokens: 2 },
      options: { outputTokens: 9 },
      expected: { contextUsed: 10, outputTokens: 9, cacheRead: 5 },
    },
  ] as const

  for (const entry of cases) {
    it(entry.name, () => {
      expect(claudeUsage(entry.raw, entry.options)).toEqual(entry.expected)
    })
  }
})
