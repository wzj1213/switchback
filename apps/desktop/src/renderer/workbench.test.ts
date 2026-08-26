import { describe, expect, it } from "vitest"
import {
  CLOSED_WORKBENCH,
  hideWorkbench,
  scopeWorkbench,
  showActivity,
  showActivityIndex,
  showFile,
  showFiles,
  showLane,
} from "./workbench.js"

describe("右侧工作台视图状态", () => {
  it("隐藏只收起面板，重开仍回到刚才那条活动或文件", () => {
    const lane = showLane(CLOSED_WORKBENCH, "lane-a")
    expect(showActivity(hideWorkbench(lane))).toEqual(lane)

    const file = showFile(lane, { threadId: "thread-a", cwd: "/w", path: "out.html" })
    expect(showFiles(hideWorkbench(file))).toEqual(file)
  })

  it("返回活动列表只清选择，不关面板、不结束 lane", () => {
    expect(showActivityIndex(showLane(CLOSED_WORKBENCH, "lane-a"))).toEqual({
      visible: true,
      page: "activity",
    })
  })

  it("切工作区只投影有效选择，原状态不被破坏", () => {
    const original = showFile(showLane(CLOSED_WORKBENCH, "lane-a"), {
      threadId: "thread-a", cwd: "/a", path: "a.ts",
    })
    const scoped = scopeWorkbench(original, new Set(["lane-b"]), "thread-b", "/b")
    expect(scoped).toEqual({ visible: true, page: "files", laneId: undefined, file: undefined })
    expect(original).toMatchObject({ laneId: "lane-a", file: { threadId: "thread-a", cwd: "/a" } })
  })

  it("仍然有效时原样返回，流式重绘不会白换引用", () => {
    const state = showLane(CLOSED_WORKBENCH, "lane-a")
    expect(scopeWorkbench(state, new Set(["lane-a"]), "thread-a", "/w")).toBe(state)
  })

  it("同一工作区切到另一条会话也不串用旧文件", () => {
    const original = showFile(CLOSED_WORKBENCH, {
      threadId: "thread-a", cwd: "/same", path: "outside.md",
    })
    expect(scopeWorkbench(original, new Set(), "thread-b", "/same").file).toBeUndefined()
    expect(scopeWorkbench(original, new Set(), "thread-a", "/same").file).toEqual(original.file)
  })
})
