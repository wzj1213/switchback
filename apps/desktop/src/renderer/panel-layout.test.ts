import { describe, expect, it } from "vitest"
import {
  panelShellClass,
  shouldClosePanelAfterDrop,
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
    const cases: readonly [number, boolean, boolean, boolean][] = [
      [1280, false, true, false],
      [1241, false, true, false],
      [1240, false, true, true],
      [860, false, true, true],
      [1172, false, false, false],
      [1040, false, false, true],
      [1280, true, false, true],
    ]
    for (const [viewportWidth, full, rail, expected] of cases) {
      expect(shouldClosePanelAfterDrop(viewportWidth, full, rail)).toBe(expected)
    }
  })
})
