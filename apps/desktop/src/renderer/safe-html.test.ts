import { describe, expect, it } from "vitest"
import { sandboxHtml } from "./safe-html.js"

describe("HTML 预览隔离壳", () => {
  it("把限制放进 head 的第一位；没有 head 时补一个", () => {
    const existing = sandboxHtml("<!doctype html><html><head><title>x</title></head><body>x</body></html>")
    const added = sandboxHtml("<html><body>x</body></html>")
    expect(existing.indexOf("Content-Security-Policy")).toBeLessThan(existing.indexOf("<title>"))
    expect(added).toContain("<html><head><meta http-equiv=\"Content-Security-Policy\"")
    expect(added).toContain("connect-src 'none'")
    expect(added).toContain("script-src 'unsafe-inline'")
  })
})
