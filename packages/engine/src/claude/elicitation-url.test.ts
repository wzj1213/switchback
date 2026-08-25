import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { urlPrompt } from "./elicitation-url.js"

const request = (url: string, elicitationId: string | undefined = "el"): ElicitationRequest => ({
  serverName: "vault",
  message: "前往外部页面完成授权",
  mode: "url",
  url,
  ...(elicitationId === undefined ? {} : { elicitationId }),
})

describe("Claude MCP URL elicitation 安全边界", () => {
  it("保留完整 URL、突出域名并标出容易误判的地址", () => {
    const cases: readonly [string, string, string | undefined][] = [
      ["https://example.com/connect?q=1#done", "example.com", undefined],
      ["http://example.com/connect", "example.com", "不是 HTTPS"],
      ["https://xn--80ak6aa92e.com/connect", "xn--80ak6aa92e.com", "Punycode"],
      ["http://127.0.0.1:8787/connect", "127.0.0.1:8787", undefined],
    ]
    for (const [url, host, warning] of cases) {
      const external = urlPrompt(request(url))?.external
      expect(external?.url).toBe(url)
      expect(new URL(external?.url ?? "").host).toBe(host)
      if (warning === undefined) expect(external?.warning).toBeUndefined()
      else expect(external?.warning).toContain(warning)
    }
  })

  it("拒绝不能交给系统浏览器安全接管的形状", () => {
    const cases: readonly ElicitationRequest[] = [
      request("javascript:alert(1)"),
      request("file:///tmp/secret"),
      request("https://user:pass@example.com/connect"),
      request("not a url"),
      request("https://example.com", ""),
      request(`https://example.com/${"x".repeat(4097)}`),
    ]
    for (const value of cases) expect(urlPrompt(value)).toBeUndefined()
  })
})
