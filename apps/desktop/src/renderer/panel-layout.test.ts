import { describe, expect, it } from "vitest"
import { panelShellClass } from "./panel-layout.js"

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
})
