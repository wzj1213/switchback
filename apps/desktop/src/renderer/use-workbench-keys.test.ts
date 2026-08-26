import { describe, expect, it } from "vitest"
import { workbenchFocusSelector } from "./use-workbench-keys.js"

describe("工作台初始焦点", () => {
  it("索引进主入口，详情进返回键", () => {
    const cases = [
      { state: { page: "files" as const }, selector: '.workbench__page:not([hidden]) .files-search input' },
      { state: { page: "files" as const, file: { threadId: "t", cwd: "/w", path: "a.ts" } }, selector: '.workbench__page:not([hidden]) .workbench__back' },
      { state: { page: "activity" as const }, selector: ".workbench__tab--on" },
      { state: { page: "activity" as const, laneId: "lane" }, selector: '.workbench__page:not([hidden]) .workbench__back' },
    ]
    for (const one of cases) expect(workbenchFocusSelector(one.state)).toBe(one.selector)
  })
})
