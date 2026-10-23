import { describe, expect, it } from "vitest"
import { DEFAULT_LOCALE, count, defineMessages, isLocale, langTag } from "./index.js"

describe("语言", () => {
  const cases: readonly [unknown, boolean][] = [["zh-CN", true], ["en", true], ["en-US", false], ["", false], [undefined, false], [1, false]]
  for (const [value, expected] of cases) {
    it(`isLocale(${JSON.stringify(value)}) → ${String(expected)}`, () => {
      expect(isLocale(value)).toBe(expected)
    })
  }

  it("默认中文，标签按 BCP 47", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN")
    expect([langTag("zh-CN"), langTag("en")]).toEqual(["zh-CN", "en-US"])
  })
})

describe("英文单复数", () => {
  const cases: readonly [number, string, string | undefined, string][] = [
    [0, "file", undefined, "0 files"], [1, "file", undefined, "1 file"], [2, "file", undefined, "2 files"],
    [1, "entry", "entries", "1 entry"], [3, "entry", "entries", "3 entries"],
  ]
  for (const [n, one, many, expected] of cases) {
    it(expected, () => {
      expect(count(n, one, many)).toBe(expected)
    })
  }
})

describe("一份文案的中英两版", () => {
  const MESSAGES = defineMessages(
    { title: "设置", files: (n: number) => `改了 ${String(n)} 个文件` },
    { title: "Settings", files: (n) => `${count(n, "file")} changed` },
  )

  it("按语言取", () => {
    expect([MESSAGES["zh-CN"].title, MESSAGES.en.title]).toEqual(["设置", "Settings"])
    expect([MESSAGES["zh-CN"].files(2), MESSAGES.en.files(1)]).toEqual(["改了 2 个文件", "1 file changed"])
  })

  it("英文少一个键、参数对不上，类型检查过不去", () => {
    // @ts-expect-error 英文那一版少了 files 这个键
    defineMessages({ title: "设置", files: (n: number) => String(n) }, { title: "Settings" })
    // @ts-expect-error files 的参数对不上
    defineMessages({ files: (n: number) => String(n) }, { files: (n: string) => n })
    expect(true).toBe(true)
  })
})
