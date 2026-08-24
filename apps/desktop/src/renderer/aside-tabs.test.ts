import { describe, expect, it } from "vitest"
import { NO_TABS, closeTab, openTab, pruneTabs } from "./aside-tabs.js"

describe("第三栏的标签", () => {
  const three = ["a", "b", "c"].reduce(openTab, NO_TABS)

  it("打开就切过去，按打开顺序排——「先开的在左边」靠的是这个", () => {
    expect(three).toEqual({ open: ["a", "b", "c"], active: "c" })
  })

  it("**已经开着的不重复加一个标签**，只切过去", () => {
    expect(openTab(three, "a")).toEqual({ open: ["a", "b", "c"], active: "a" })
  })

  it("关掉当前那条，焦点落到右边——和浏览器一样", () => {
    expect(closeTab(openTab(three, "b"), "b")).toEqual({ open: ["a", "c"], active: "c" })
  })

  it("关掉最后一条，焦点落到左边", () => {
    expect(closeTab(three, "c")).toEqual({ open: ["a", "b"], active: "b" })
  })

  it("关掉不是当前的那条，焦点不动——不该因为收拾别的标签把你正看的挪走", () => {
    expect(closeTab(three, "a")).toEqual({ open: ["b", "c"], active: "c" })
  })

  it("全关完 active 空掉，整栏收起（不是渲染一个宽度 0 的列）", () => {
    expect(["a", "b", "c"].reduce(closeTab, three)).toEqual({ open: [], active: undefined })
  })

  it("关一个不存在的原样返回——**同一个引用**，memo 才不会白失效", () => {
    expect(closeTab(three, "没有这条")).toBe(three)
  })

  it("**lane 没了标签跟着没**：留着的是一个点了什么都没有的标签", () => {
    expect(pruneTabs(three, new Set(["a", "c"]))).toEqual({ open: ["a", "c"], active: "c" })
  })

  it("当前那条没了就落到最后一个还在的", () => {
    expect(pruneTabs(three, new Set(["a"]))).toEqual({ open: ["a"], active: "a" })
  })

  it("全没了就收起", () => {
    expect(pruneTabs(three, new Set())).toEqual({ open: [], active: undefined })
  })

  it("都还在就原样返回——每帧都算，引用不稳会让整栏白重渲染", () => {
    expect(pruneTabs(three, new Set(["a", "b", "c"]))).toBe(three)
  })
})
