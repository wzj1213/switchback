import { describe, expect, it } from "vitest"
import { openExternalSafely, safeExternalUrl } from "./external-url.js"

describe("外链安全边界", () => {
  const cases = [
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["HTTP://example.com", "http://example.com/"],
    ["mailto:hello@example.com", "mailto:hello@example.com"],
    ["javascript:alert(1)", undefined],
    ["data:text/html,hello", undefined],
    ["file:///etc/passwd", undefined],
    ["shell:open", undefined],
    ["/relative/path", undefined],
    ["", undefined],
  ] as const

  it("只接受明确允许的协议", () => {
    for (const [raw, expected] of cases) expect(safeExternalUrl(raw)).toBe(expected)
  })

  it("拒绝时不调用系统，且留下可诊断记录", async () => {
    const opened: string[] = []
    const reports: string[] = []
    const ok = await openExternalSafely("file:///tmp/nope", {
      open: (url) => {
        opened.push(url)
        return Promise.resolve()
      },
      report: (message) => reports.push(message),
    })
    expect(ok).toBe(false)
    expect(opened).toEqual([])
    expect(reports[0]).toContain("已拦截")
  })

  it("系统打开失败时吞掉拒绝并写诊断", async () => {
    const reports: string[] = []
    const ok = await openExternalSafely("https://example.com", {
      open: () => Promise.reject(new Error("boom")),
      report: (message) => reports.push(message),
    })
    expect(ok).toBe(false)
    expect(reports[0]).toContain("boom")
  })
})
