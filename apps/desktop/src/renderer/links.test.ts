import { describe, expect, it } from "vitest"
import { isGitHubLink, linkParts } from "./links.js"

describe("对话里的链接", () => {
  it("只识别 http(s)，并把句末标点留在链接外", () => {
    const cases = [
      ["看 https://example.com/a。", ["看 ", "https://example.com/a", "。"]],
      ["看 https://example.com/a，然后继续", ["看 ", "https://example.com/a", "，然后继续"]],
      ["(https://example.com/a)", ["(", "https://example.com/a", ")"]],
      ["https://example.com/a_(b)", ["https://example.com/a_(b)"]],
      ["file:///tmp/a 和 javascript:alert(1)", ["file:///tmp/a 和 javascript:alert(1)"]],
    ] as const
    for (const [input, expected] of cases) {
      expect(linkParts(input).map((part) => part.text)).toEqual(expected)
    }
  })

  it("多个链接保持原顺序与中间文字", () => {
    expect(linkParts("A https://a.test/x B https://b.test/y")).toEqual([
      { kind: "text", text: "A " },
      { kind: "link", text: "https://a.test/x", href: "https://a.test/x" },
      { kind: "text", text: " B " },
      { kind: "link", text: "https://b.test/y", href: "https://b.test/y" },
    ])
  })

  it("GitHub 只认同站域名，不被相似域名骗过", () => {
    const cases = [
      ["https://github.com/openai/codex", true],
      ["https://www.github.com/openai/codex", true],
      ["https://github.com.evil.test/openai/codex", false],
      ["https://example.com/github.com", false],
    ] as const
    for (const [href, expected] of cases) expect(isGitHubLink(href)).toBe(expected)
  })
})
