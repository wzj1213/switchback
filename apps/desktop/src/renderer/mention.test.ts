import { describe, expect, it } from "vitest"
import { applyMention, mentionAt } from "./mention.js"

describe("mentionAt", () => {
  it("行首的 @ 算", () => {
    expect(mentionAt("@host", 5)).toEqual({ start: 0, end: 5, query: "host" })
  })

  it("空白之后的 @ 算", () => {
    // "看看 " 三个字符，@ 落在下标 3
    expect(mentionAt("看看 @src/ho", 10)).toMatchObject({ start: 3, query: "src/ho" })
  })

  it("刚打出 @ 还没输入时也算——一按就该弹列表", () => {
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" })
  })

  it("`user@host` 里的不算——@ 前面不是空白", () => {
    expect(mentionAt("user@host", 9)).toBeUndefined()
  })

  it("邮箱里的也不算", () => {
    expect(mentionAt("联系 a.b@c.com", 12)).toBeUndefined()
  })

  it("打了空格就结束了——那次引用已经完成", () => {
    expect(mentionAt("@src/a.ts 然后", 12)).toBeUndefined()
  })

  it("只看光标之前：后面还有别的字不影响", () => {
    expect(mentionAt("@ho 后面的字", 3)).toMatchObject({ query: "ho" })
  })

  it("取最近的那个 @", () => {
    expect(mentionAt("@a 再 @b", 7)).toMatchObject({ query: "b" })
  })

  it("没有 @ 时 undefined", () => {
    expect(mentionAt("普通文本", 4)).toBeUndefined()
  })
})

/** 测试里少写一个非空断言：找不到 mention 就是用例写错了，直接抛比 `!` 清楚。 */
function at(text: string, caret: number): { start: number; end: number; query: string } {
  const found = mentionAt(text, caret)
  if (found === undefined) throw new Error(`用例有问题：${text} @${String(caret)} 处没有 mention`)
  return found
}

describe("applyMention", () => {
  it("替换 token 并补一个空格，光标落在空格之后", () => {
    expect(applyMention("看看 @ho", at("看看 @ho", 6), "src/host.ts")).toEqual({
      // "看看 " 3 + "@src/host.ts " 13
      text: "看看 @src/host.ts ",
      caret: 16,
    })
  })

  it("保留光标后面的内容", () => {
    expect(applyMention("@ho 后面", at("@ho 后面", 3), "a.ts").text).toBe("@a.ts  后面")
  })

  it("候选路径有空格时引用边界不会断在半路", () => {
    expect(applyMention("看 @note", at("看 @note", 7), "docs/my note.md").text)
      .toBe("看 @\"docs/my note.md\" ")
  })
})
