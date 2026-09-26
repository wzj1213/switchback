import { describe, expect, it } from "vitest"
import { estimateTokens } from "./tokens.js"

/**
 * 参考数是常见分词器上的实数（cl100k / o200k 一类，四舍五入）。估算只要求落在 ±25% 以内——
 * 要的是**不跟着语言漂**：同样多的真 token，中文、英文、代码三种写法估出来要在同一档。
 */
describe("按字符种类估 token", () => {
  const cases: readonly [string, string, number][] = [
    ["英文正文", "The quick brown fox jumps over the lazy dog.", 10],
    ["中文正文", "分页那段和订阅方式几乎一样，可以直接照搬，只有两处要注意。", 24],
    ["中英夹杂", "换会话时要清滑窗，不然切过去的头一秒 useFlow 读到的是上一条会话的速度。", 30],
    ["代码", "export function usePager(thread: ThreadId | undefined) {\n  const meter = useRef(createMeter())\n}", 26],
    ["表情", "好的👍", 3],
  ]
  for (const [name, text, real] of cases) {
    it(name, () => {
      const got = estimateTokens(text)
      expect(got).toBeGreaterThan(real * 0.75)
      expect(got).toBeLessThan(real * 1.25)
    })
  }

  it("空白不算钱：空格并进后面那个词", () => {
    expect(estimateTokens("   ")).toBe(0)
    expect(estimateTokens("")).toBe(0)
  })
})
