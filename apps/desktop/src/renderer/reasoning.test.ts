import { describe, expect, it } from "vitest"
import { summaryOf } from "./reasoning.js"

describe("推理折行取哪一行", () => {
  const text = "先看现有实现。\n有三种方案。\n我倾向第二种。"

  it("**跑着的时候看最后一行**——第一行是几十秒前的事了", () => {
    expect(summaryOf(text, true)).toBe("我倾向第二种。")
  })

  it("**跑完看第一行**——那时要的是「这段讲的是什么」", () => {
    expect(summaryOf(text, false)).toBe("先看现有实现。")
  })

  it("末尾的换行不算一行——流式时最后一个字符常常正好是换行", () => {
    expect(summaryOf("一\n二\n", true)).toBe("二")
  })

  it("单行时两种模式给同一个结果", () => {
    expect(summaryOf("就一句", true)).toBe("就一句")
    expect(summaryOf("就一句", false)).toBe("就一句")
  })

  it("空文本不炸", () => {
    expect(summaryOf("", true)).toBe("")
    expect(summaryOf("", false)).toBe("")
  })
})
