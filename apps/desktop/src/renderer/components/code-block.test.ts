import { describe, expect, it } from "vitest"
import { langOf } from "./code-block.js"

describe("代码块上那条工具栏写哪个语言", () => {
  it("认 rehype-highlight 写下的那一个，不自己猜", () => {
    const cases = [
      ["hljs language-typescript", "typescript"],
      ["language-ts hljs", "ts"],
      ["hljs language-c++", "c++"],
      ["hljs language-c#", "c#"],
      ["hljs language-objective-c", "objective-c"],
    ] as const
    for (const [className, lang] of cases) expect(langOf(className)).toBe(lang)
  })

  it("没写语言、没认出来、或者根本没有 class 时返回 undefined——由界面写「代码」", () => {
    for (const className of ["hljs", "", "  ", undefined, "mylanguage-ts", "language-"]) {
      expect(langOf(className)).toBeUndefined()
    }
  })
})
