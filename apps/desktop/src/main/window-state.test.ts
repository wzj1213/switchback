import { describe, expect, it } from "vitest"
import { visibleOn, type Bounds } from "./window-state.js"

const screen1: Bounds = { x: 0, y: 0, width: 1440, height: 900 }
/** 外接屏在主屏右侧 */
const screen2: Bounds = { x: 1440, y: 0, width: 1920, height: 1080 }

describe("visibleOn", () => {
  it("完全在主屏里", () => {
    expect(visibleOn({ x: 100, y: 100, width: 800, height: 600 }, [screen1])).toBe(true)
  })

  it("外接屏拔掉之后，存在那块屏上的坐标不再可见——不然窗口会开在看不见的地方", () => {
    const onSecond: Bounds = { x: 2000, y: 200, width: 900, height: 700 }
    expect(visibleOn(onSecond, [screen1, screen2])).toBe(true)
    expect(visibleOn(onSecond, [screen1])).toBe(false)
  })

  it("露出一角就算可见——用户自己拖到边上是他的自由", () => {
    expect(visibleOn({ x: 1300, y: 800, width: 800, height: 600 }, [screen1])).toBe(true)
  })

  it("只露出一条缝不算——80px 以下够不着标题栏，等于拿不回来", () => {
    expect(visibleOn({ x: 1420, y: 100, width: 800, height: 600 }, [screen1])).toBe(false)
  })

  it("完全在屏幕上方（比如菜单栏被改过）也算不可见", () => {
    expect(visibleOn({ x: 100, y: -700, width: 800, height: 600 }, [screen1])).toBe(false)
  })

  it("一块屏都没有时一律不可见，回落到默认值", () => {
    expect(visibleOn({ x: 0, y: 0, width: 100, height: 100 }, [])).toBe(false)
  })
})
