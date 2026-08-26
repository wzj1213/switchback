import { describe, expect, it } from "vitest"
import { changeNote, type ChangeSource } from "./changed-note.js"

describe("文件改动摘要的置信度说明", () => {
  it("按真实原因区分非仓库、读取失败与旧会话", () => {
    const cases: readonly [ChangeSource, string | undefined][] = [
      [{ baseline: true, failed: false, noRepo: false }, undefined],
      [{ baseline: false, failed: false, noRepo: true }, "工作区不是 Git 仓库，以下采用引擎最后一次上报"],
      [{ baseline: false, failed: true, noRepo: false }, "读取 Git 差异失败，当前无法确认本次对话是否留下文件改动"],
      [{ baseline: false, failed: false, noRepo: false },
        "这条会话没有开场基线；以下只说明上报路径当前相对 HEAD 仍有改动，不能归因到本次对话"],
    ]
    for (const [state, expected] of cases) expect(changeNote(state, [])).toBe(expected)
  })

  it("Git 失败但仍有引擎上报时明确说明数字来自降级来源", () => {
    const file = { path: "/w/x.ts", added: 1, removed: 0,
      last: { path: "/w/x.ts", kind: "update" as const, added: 1, removed: 0 } }
    expect(changeNote({ baseline: false, failed: true, noRepo: false }, [file]))
      .toBe("读取 Git 差异失败，以下暂用引擎最后一次上报")
  })
})
