import { describe, expect, it } from "vitest"
import { failureKind, humanize, type FailureKind } from "./failure.js"

describe("把引擎的报错翻成人话", () => {
  it("JSON 里捞出那句 message——实测 codex 就这么报的", () => {
    const raw = `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}}`
    expect(humanize(raw).text).toBe(
      "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.",
    )
  })

  it("捞得出就要留「详情」——**翻译不能把原文弄丢**，用户要拿它去搜去开 issue", () => {
    expect(humanize(`{"error":{"message":"炸了"}}`).detailed).toBe(true)
  })

  it("剥掉给引擎作者看的诊断尾巴——实测 claude 那条", () => {
    const raw = "Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"
    expect(humanize(raw).text).toBe("Claude Code returned an error result:")
  })

  it("**认不出的形状原样显示**，宁可难看也不能把唯一的线索藏起来", () => {
    expect(humanize("引擎莫名其妙地没了")).toEqual({ text: "引擎莫名其妙地没了", detailed: false })
  })

  it("不是 JSON 就别去 parse——普通句子里带个花括号也不该被当成结构", () => {
    expect(humanize("函数体 { 里有个大括号").text).toBe("函数体 { 里有个大括号")
  })

  it("嵌套多深都捞得到（各家层数不一样，写死路径会漏）", () => {
    expect(humanize(`{"a":{"b":{"c":{"message":"深处的那句"}}}}`).text).toBe("深处的那句")
  })

  it("空 message 不算——那还不如显示原文", () => {
    expect(humanize(`{"message":"   ","x":1}`).text).toBe(`{"message":"   ","x":1}`)
  })
})

describe("终态报错的抬头只认原文里明写的", () => {
  const cases: readonly [string, FailureKind][] = [
    ["429 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.", "quota"],
    ["403 You've reached your weekly (7-day) usage limit.", "quota"],
    ["You exceeded your current quota, please check your plan and billing details.", "quota"],
    ["rate_limit_error: Number of request tokens has exceeded your per-minute rate limit", "rate"],
    ["429 Too Many Requests", "rate"],
    ["401 Unauthorized", "auth"],
    ["Invalid API key provided", "auth"],
    ["504 Gateway Time-out", "server"],
    ["529 Overloaded", "server"],
    ["stream disconnected before completion: idle timeout waiting for SSE", "network"],
    ["Connection error.", "network"],
    ["read ECONNRESET", "network"],
    ["The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.", "other"],
    ["引擎莫名其妙地没了", "other"],
  ]
  for (const [raw, want] of cases) it(`${want} ← ${raw.slice(0, 40)}`, () => expect(failureKind(raw)).toBe(want))
})

