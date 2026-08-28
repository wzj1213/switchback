import { describe, expect, it } from "vitest"
import { wordMarks } from "./review-words.js"

/** 把区间还原成它标出来的那几段文字——断言里读得懂的形式。 */
function marked(text: string, spans: readonly { start: number; end: number }[]): string[] {
  return spans.map((span) => text.slice(span.start, span.end))
}

/**
 * 词级高亮是审核里最省神的一件事：**「改了一个词」和「重写了整行」不该长得一样**。
 * 而它算错了不会报错，只会让人盯着两行看半天——所以它按表钉住。
 */
describe("wordMarks", () => {
  const table: readonly { name: string; del: string; add: string; hits: [string[], string[]] }[] = [
    {
      name: "只改了一个标识符：两侧各只标那一个词，等号和数字不动",
      del: "const openable = 1",
      add: "const lastAnswerAt = 1",
      hits: [["openable"], ["lastAnswerAt"]],
    },
    {
      name: "中文按字切：只标真正换掉的那几个字，不是整句",
      del: "// 那一列答的是「多久以前」",
      add: "// 这一列答的是「多久以前」",
      hits: [["那"], ["这"]],
    },
    {
      name: "只在行尾追加：删侧一个字都不标",
      del: "return rows.filter(fn)",
      add: "return rows.filter(fn) // 预扫一遍",
      hits: [[], [" // 预扫一遍"]],
    },
  ]

  for (const row of table) {
    it(row.name, () => {
      const out = wordMarks(row.del, row.add)
      expect(out).toBeDefined()
      expect(marked(row.del, out?.del ?? [])).toEqual(row.hits[0])
      expect(marked(row.add, out?.add ?? [])).toEqual(row.hits[1])
    })
  }

  /**
   * 不标的那几种。**三种情况调用方的动作一样**（整行只留底色），
   * 所以出口只有一个 `undefined`，不分辨是哪一种。
   */
  it("整行重写：公共部分不足三成就整行不标——全标满等于没标", () => {
    expect(wordMarks("const openable = new Set(rows)", "// 留下的就是最后那条")).toBeUndefined()
  })

  /**
   * **标点和空白不算分。** 逐行对位会把一段大改里毫不相干的两行配到一起，
   * 而它们的括号、逗号、冒号和缩进全都对得上——分母里塞满标点，闸门就等于没有。
   * 这一对是真机出图里抓到的。
   */
  it("只有括号逗号对得上不算像：一个共同的词都没有就不标", () => {
    const del = "    const html = renderToStaticMarkup(createElement(ReviewDiff, {"
    const add = "function render(split: boolean, path = \"x.ts\"): string {"
    expect(wordMarks(del, add)).toBeUndefined()
  })

  it("而真的只差一个词时照标不误——闸门收紧不能把该标的一起挡掉", () => {
    const out = wordMarks("  if (row.kind === \"turn\") return true", "  if (row.kind === \"item\") return true")
    expect(marked("  if (row.kind === \"item\") return true", out?.add ?? [])).toEqual(["item"])
  })

  it("两行一模一样、任一侧是空行：都没有「变了的那几个字」可说", () => {
    expect(wordMarks("same", "same")).toBeUndefined()
    expect(wordMarks("", "x")).toBeUndefined()
    expect(wordMarks("x", "")).toBeUndefined()
  })

  it("超长行走上限出口：LCS 是 O(n·m)，不能让一行 4000 字符的压缩产物把界面卡住", () => {
    const long = "x ".repeat(3000)
    expect(wordMarks(long, `${long}y`)).toBeUndefined()
  })

  /** 相邻的两个 token 都变了要并成一段：分开标会在一个词里画出好几块底色。 */
  it("连着变的几个 token 并成一段，不碎成一堆", () => {
    const out = wordMarks("a bb cc d", "a xx yy d")
    expect(marked("a xx yy d", out?.add ?? [])).toEqual(["xx yy"])
  })
})
