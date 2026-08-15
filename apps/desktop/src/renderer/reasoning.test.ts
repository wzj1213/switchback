import { describe, expect, it } from "vitest"
import { headingOf, summaryOf } from "./reasoning.js"

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

describe("模型自己起的小标题", () => {
  it("整行加粗的那行就是标题", () => {
    expect(headingOf("**先确认分页的边界条件**\n\npage 从 0 还是 1 开始…")).toBe("先确认分页的边界条件")
  })

  it("**取最后一个**——长推理分好几节，人要的是现在这一节", () => {
    expect(headingOf("**看边界**\n聊了几句\n\n**再看调用方**\n又聊了几句")).toBe("再看调用方")
  })

  it("行内加粗一个词不算标题", () => {
    expect(headingOf("这里 **page** 是从 0 开始的")).toBeUndefined()
  })

  it("没有加粗行就返回 undefined，让调用方退回「正在思考」——**编一个才是错的**", () => {
    expect(headingOf("就是一段普通的推理文字")).toBeUndefined()
  })

  it("空文本不炸", () => {
    expect(headingOf("")).toBeUndefined()
  })

  it("标题里再套加粗会截出半截，不要", () => {
    expect(headingOf("**先看 **page** 这个参数**")).toBeUndefined()
  })
})
