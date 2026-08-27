import { describe, expect, it } from "vitest"
import { tipSpot } from "./tips.js"

const view = { width: 1280, height: 800 }
const box = (left: number, top: number): Parameters<typeof tipSpot>[0] =>
  ({ left, top, right: left + 24, bottom: top + 24 })

describe("悬停提示摆在哪儿", () => {
  it("默认在上方居中——工具栏底下通常紧接着就是你正要看的内容", () => {
    const at = tipSpot(box(600, 400), view)
    expect(at.side).toBe("top")
    expect(at.left).toBe(612)
    expect(at.top).toBe(392)
  })

  it("贴着窗口顶边时翻到下方（顶栏那一排就是这种）", () => {
    const at = tipSpot(box(600, 8), view)
    expect(at.side).toBe("bottom")
    expect(at.top).toBe(40)
  })

  it("贴着左右边时夹住，不让它探出窗口", () => {
    expect(tipSpot(box(0, 400), view).left).toBe(86)
    expect(tipSpot(box(1260, 400), view).left).toBe(1194)
  })
})
