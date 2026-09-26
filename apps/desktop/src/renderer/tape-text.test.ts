import { describe, expect, it } from "vitest"
import { clearTapeText, createTapeText, nextChar, pushText } from "./tape-text.js"

/** 写进去一段，连取 `n` 发。 */
function take(text: string, n: number): string {
  const tape = createTapeText()
  pushText(tape, text)
  return Array.from({ length: n }, () => nextChar(tape)).join("")
}

describe("纸带上落的字", () => {
  const cases: readonly (readonly [string, string, number, string])[] = [
    ["按写出来的顺序落", "换会话", 3, "换会话"],
    ["空白不落：落一个空格等于什么都没落", "a b\n c", 3, "abc"],
    ["Markdown 的标记不落：那是排版指令，不是话", "**结论：**`x`", 4, "结论：x"],
    ["表格和列表的骨架也不落", "| a |\n|---|\n- b", 2, "ab"],
    ["没有新字了就再落最后那个：读起来仍是那段话的尾巴", "ab", 4, "abbb"],
    ["一个字都还没有时落一个点", "", 2, "··"],
  ]
  for (const [name, text, n, want] of cases) {
    it(name, () => {
      expect(take(text, n)).toBe(want)
    })
  }

  it("只留最近的一截：字来得比子弹快时，落的永远是刚写出来的", () => {
    const tape = createTapeText()
    pushText(tape, "旧".repeat(100))
    pushText(tape, "新".repeat(48))
    expect(nextChar(tape)).toBe("新")
  })

  it("换会话清空：上一条会话写的字不属于这一条", () => {
    const tape = createTapeText()
    pushText(tape, "上一条")
    clearTapeText(tape)
    expect(nextChar(tape)).toBe("·")
  })
})
