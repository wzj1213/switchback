import { describe, expect, it } from "vitest"
import { parseDiff } from "./diff.js"
import { numbered, trimMeta } from "./review-lines.js"
import { hunkBody, quoteHunk, quoteLabel } from "./review-quote.js"

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,4 +10,4 @@ function a() {",
  " const x = 1",
  "-const y = 2",
  "+const y = 3",
  " return x + y",
  "@@ -40,3 +40,1 @@",
  " keep()",
  "-gone()",
  "-alsoGone()",
].join("\n")

const lines = trimMeta(numbered(parseDiff(PATCH, "update")))
const hunks = lines.map((line, index) => (line.kind === "hunk" ? index : -1)).filter((index) => index >= 0)

describe("引用 diff 里的一段", () => {
  it("一段到下一段 hunk 头为止", () => {
    expect(hunkBody(lines, hunks[0] ?? 0).map((line) => line.text)).toEqual(["const x = 1", "const y = 2", "const y = 3", "return x + y"])
  })

  it("位置按新侧行号，正文原样带 +/- 前缀", () => {
    expect(quoteHunk("src/a.ts", lines, hunks[0] ?? 0)).toBe(
      ["src/a.ts:10-12", "```diff", " const x = 1", "-const y = 2", "+const y = 3", " return x + y", "```"].join("\n"),
    )
  })

  it("新侧只剩一行时只写一个行号", () => {
    expect(quoteHunk("src/a.ts", lines, hunks[1] ?? 0)?.split("\n")[0]).toBe("src/a.ts:40")
  })

  it("纯删除的段按旧侧行号", () => {
    const deleted = numbered(parseDiff("@@ -5,2 +4,0 @@\n-a\n-b", "update"))
    expect(quoteHunk("x.ts", deleted, 0)?.split("\n")[0]).toBe("x.ts:5-6")
  })

  it("正文里有 ``` 时围栏加长，不被提前截断", () => {
    const fenced = numbered(parseDiff("@@ -1,1 +1,1 @@\n-```js\n+````js", "update"))
    const quote = quoteHunk("README.md", fenced, 0) ?? ""
    expect(quote.split("\n")[1]).toBe("`````diff")
    expect(quote.endsWith("\n`````")).toBe(true)
  })

  it("空段不引用；芯片上写文件与行号", () => {
    expect(quoteHunk("x.ts", numbered(parseDiff("@@ -1,0 +1,0 @@", "update")), 0)).toBeUndefined()
    expect(quoteLabel("src/a.ts:10-12\n```diff", "zh-CN")).toBe("引用 src/a.ts:10-12")
  })

  it("太长的段只附前 300 行", () => {
    const long = numbered(parseDiff(["@@ -1,400 +1,400 @@", ...Array.from({ length: 400 }, (_, i) => ` line ${String(i)}`)].join("\n"), "update"))
    const body = (quoteHunk("big.txt", long, 0) ?? "").split("\n")
    expect(body.length).toBe(1 + 1 + 300 + 1 + 1)
    expect(body.at(-2)).toBe("…")
  })
})
