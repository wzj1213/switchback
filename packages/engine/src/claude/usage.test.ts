import { describe, expect, it } from "vitest"
import { claudeUsage } from "./usage.js"

describe("Claude 用量", () => {
  const cases = [
    {
      name: "合并输入、缓存与输出并保留窗口",
      raw: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 7 },
      window: 200,
      expected: { contextUsed: 42, contextWindow: 200, outputTokens: 7, cacheRead: 20 },
    },
    {
      name: "原生字段缺席时不拿零冒充已上报",
      raw: { input_tokens: 3 },
      window: undefined,
      expected: { contextUsed: 3 },
    },
  ] as const

  for (const entry of cases) {
    it(entry.name, () => {
      expect(claudeUsage(entry.raw, entry.window)).toEqual(entry.expected)
    })
  }
})
