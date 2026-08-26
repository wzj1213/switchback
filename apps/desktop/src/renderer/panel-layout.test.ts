import { describe, expect, it } from "vitest"
import {
  panelShellClass,
  shouldClosePanelAfterDrop,
  shouldHidePanelAfterResize,
} from "./panel-layout.js"

describe("工具面板外壳", () => {
  it("关闭、并排、独占各自只带需要的类", () => {
    const cases: readonly [boolean, boolean, string][] = [
      [false, false, "shell"],
      [false, true, "shell"],
      [true, false, "shell shell--workbench"],
      [true, true, "shell shell--workbench shell--workbench-full"],
    ]
    for (const [open, full, expected] of cases) {
      expect(panelShellClass(open, full)).toBe(expected)
    }
  })

  it("只有窄窗或手动独占时才在拖放后关闭工具组", () => {
    const cases: readonly [number, boolean, boolean][] = [
      [1172, false, false],
      [1121, false, false],
      [1120, false, true],
      [860, false, true],
      [1172, true, true],
    ]
    for (const [viewportWidth, full, expected] of cases) {
      expect(shouldClosePanelAfterDrop(viewportWidth, full)).toBe(expected)
    }
  })

  it("只有从双栏跨进单栏时才让工具面板给会话让位", () => {
    const cases: readonly [number, number, boolean][] = [
      [1172, 1120, true],
      [1121, 860, true],
      [1172, 1121, false],
      [860, 720, false],
      [860, 1172, false],
    ]
    for (const [previous, next, expected] of cases) {
      expect(shouldHidePanelAfterResize(previous, next)).toBe(expected)
    }
  })
})
