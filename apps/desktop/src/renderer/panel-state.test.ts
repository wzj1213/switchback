import { describe, expect, it } from "vitest"
import {
  CLOSED_PANEL,
  closePanelTab,
  hidePanel,
  openPanel,
  togglePanel,
  togglePanelFull,
} from "./panel-state.js"

describe("右侧页签组状态", () => {
  it("打开、切换和隐藏都保留已经建好的页签", () => {
    const review = openPanel(CLOSED_PANEL, "review")
    const files = openPanel(review, "files")
    expect(files).toMatchObject({ tabs: ["review", "files"], active: "files", visible: true })
    expect(hidePanel(files)).toMatchObject({ tabs: ["review", "files"], active: "files", visible: false })
    expect(togglePanel(hidePanel(files))).toMatchObject({ active: "files", visible: true })
  })

  it("关闭当前页选中相邻页，关完最后一页才收起整组", () => {
    const state = openPanel(openPanel(openPanel(CLOSED_PANEL, "review"), "activity"), "files")
    expect(closePanelTab(state, "files")).toMatchObject({ tabs: ["review", "activity"], active: "activity" })
    expect(closePanelTab(closePanelTab(state, "activity"), "review")).toMatchObject({
      tabs: ["files"], active: "files", visible: true,
    })
    expect(closePanelTab(openPanel(CLOSED_PANEL, "review"), "review")).toEqual(CLOSED_PANEL)
  })

  it("独占只在面板可见时切换，隐藏会退出独占", () => {
    expect(togglePanelFull(CLOSED_PANEL)).toBe(CLOSED_PANEL)
    const full = togglePanelFull(openPanel(CLOSED_PANEL, "review"))
    expect(full.full).toBe(true)
    expect(hidePanel(full)).toMatchObject({ visible: false, full: false })
  })
})
