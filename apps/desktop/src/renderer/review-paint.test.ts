import { describe, expect, it } from "vitest"
import { parseDiff } from "./diff.js"
import { numbered, type NumberedLine } from "./review-lines.js"
import { paintPatch, type Seg } from "./review-paint.js"

function linesOf(patch: string): readonly NumberedLine[] {
  return numbered(parseDiff(patch, "update"))
}

function segsOf(patch: string, text: string, path = "x.ts"): readonly Seg[] | undefined {
  const lines = linesOf(patch)
  const line = lines.find((one) => one.text === text)
  return line === undefined ? undefined : paintPatch(path, lines).get(line)
}

/** 这一行被染成了哪些类（去重，按出现顺序）。 */
function classes(segs: readonly Seg[] | undefined): string[] {
  return [...new Set((segs ?? []).map((seg) => seg.cls).filter((cls) => cls !== undefined))]
}

/**
 * 补丁着色。
 *
 * **补丁是一行一行给的，而语言不是**——这一族测试盯的全是同一件事：
 * 跨行状态（块注释、字符串）在哪里该断、在哪里不该断。染错了不报错，
 * 只会让人看着一屏「全是注释」的代码找不出问题在哪。
 */
describe("paintPatch · 跨行状态", () => {
  // 补丁只截了文件的几段，第一段开的那个块注释在这份补丁里**永远等不到**它的结束标记
  const ACROSS_HUNKS = [
    "@@ -1,3 +1,3 @@",
    " /**",
    "- * 旧的说明",
    "+ * 新的说明",
    "@@ -20,2 +20,2 @@",
    "-const x = 1",
    "+const x = 2",
  ].join("\n")

  it("**上一段没闭合的块注释不许漏到下一段**——整份当一段文本扫就会全变成注释", () => {
    expect(classes(segsOf(ACROSS_HUNKS, " * 旧的说明"))).toContain("hljs-comment")
    const next = classes(segsOf(ACROSS_HUNKS, "const x = 2"))
    expect(next).toContain("hljs-keyword")
    expect(next).not.toContain("hljs-comment")
  })

  /** 删行开了个注释、增行没有：两侧拼在一起本来就不是一份合法的源码。 */
  const TWO_SIDES = [
    "@@ -1,4 +1,4 @@",
    " const a = 1",
    "-  /* 旧注释开头",
    "+  const fresh = 1",
    " const c = 3",
  ].join("\n")

  it("旧侧和新侧各扫一遍：删行开的注释不会把它下面的上下文行吃掉", () => {
    expect(classes(segsOf(TWO_SIDES, "  /* 旧注释开头"))).toContain("hljs-comment")
    // 上下文行两侧都有，取新侧那一份——那是改完之后的样子，也是人在读的那一份
    const ctx = classes(segsOf(TWO_SIDES, "const c = 3"))
    expect(ctx).toContain("hljs-keyword")
    expect(ctx).not.toContain("hljs-comment")
  })
})

describe("paintPatch · 三道闸门", () => {
  const SMALL = ["@@ -1,2 +1,2 @@", "-const x = 1", "+const x = 2"].join("\n")

  it("取不到语言就不染——沿用「没标语言就不猜」，猜错的高亮比没有更碍眼", () => {
    expect(classes(segsOf(SMALL, "const x = 2", "notes.unknownext"))).toEqual([])
    expect(classes(segsOf(SMALL, "const x = 2", "Makefile"))).toEqual([])
  })

  it("**词级高亮不吃语言**：认不出语言的文件照样看得出哪几个字变了", () => {
    const hits = segsOf(SMALL, "const x = 2", "Makefile")?.filter((seg) => seg.hit === true)
    expect(hits?.map((seg) => seg.text)).toEqual(["2"])
  })

  it("大补丁整份退回纯文本：那时候要的是快，不是颜色", () => {
    const body: string[] = ["@@ -1,4000 +1,4000 @@"]
    for (let i = 0; i < 4000; i += 1) body.push(` const v${String(i)} = ${String(i)}`)
    const lines = linesOf(body.join("\n"))
    expect(paintPatch("x.ts", lines).size).toBe(0)
  })

  it("没什么可画的行不进表：纯文本那条路一个对象都不多分配", () => {
    const lines = linesOf(["@@ -1,2 +1,2 @@", " plain text here", "-a", "+b"].join("\n"))
    const plain = lines.find((one) => one.text === "plain text here")
    expect(plain).toBeDefined()
    // `.md` 认得出这一行是段落，但段落没有 `hljs-*` 类可染，也没有配对的删增
    expect(paintPatch("notes.md", lines).get(plain as NumberedLine)).toBeUndefined()
  })
})

describe("paintPatch · 词级高亮", () => {
  const PAIRED = [
    "@@ -1,2 +1,2 @@",
    "-const openable = new Set(rows)",
    "+const lastAnswerAt = new Set(rows)",
  ].join("\n")

  it("配对的删/增行标出真正变了的那几个词，两边各标各的", () => {
    const del = segsOf(PAIRED, "const openable = new Set(rows)")
    const add = segsOf(PAIRED, "const lastAnswerAt = new Set(rows)")
    expect(del?.filter((seg) => seg.hit === true).map((seg) => seg.text)).toEqual(["openable"])
    expect(add?.filter((seg) => seg.hit === true).map((seg) => seg.text)).toEqual(["lastAnswerAt"])
  })

  it("语法色和词级底**同时**落在一截字上——两套边界一起切，不是嵌套两层", () => {
    const marked = segsOf(PAIRED, "const lastAnswerAt = new Set(rows)")?.find((seg) => seg.hit === true)
    expect(marked?.text).toBe("lastAnswerAt")
    // 整行拼回去必须一字不差，切错偏移会静默吞字
    expect((segsOf(PAIRED, "const lastAnswerAt = new Set(rows)") ?? []).map((seg) => seg.text).join(""))
      .toBe("const lastAnswerAt = new Set(rows)")
  })

  it("上下文行不参与配对：它两侧都在，标出来的只会是噪声", () => {
    const withCtx = ["@@ -1,3 +1,3 @@", " const same = 1", "-a1", "+a2"].join("\n")
    expect(segsOf(withCtx, "const same = 1")?.some((seg) => seg.hit === true)).toBe(false)
  })
})
