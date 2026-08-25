import { describe, expect, it } from "vitest"
import { retryItem } from "./retry.js"

describe("Claude API 重试", () => {
  it("只把 SDK 完整报出的可恢复重试翻成软错误", () => {
    const cases = [
      {
        raw: { attempt: 2, max_retries: 5, retry_delay_ms: 1500, error_status: 529, error: "overloaded" },
        want: {
          message: "Claude API 正在重试（2/5，1500ms 后）",
          detail: "overloaded · HTTP 529",
          fatal: false,
        },
      },
      {
        raw: { attempt: 1, max_retries: 5, retry_delay_ms: 250, error_status: null, error: "server_error" },
        want: { detail: "server_error" },
      },
      {
        raw: { attempt: 1, max_retries: 5, retry_delay_ms: -1, error_status: null, error: "server_error" },
        want: undefined,
      },
      { raw: { attempt: 1 }, want: undefined },
    ] as const
    for (const row of cases) {
      const item = retryItem(row.raw, "turn-1", 7)
      if (row.want === undefined) expect(item).toBeUndefined()
      else expect(item).toMatchObject(row.want)
    }
  })
})
