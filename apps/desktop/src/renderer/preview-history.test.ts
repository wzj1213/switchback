import { describe, expect, it } from "vitest"
import { adjacentPreview, stepPreview, visitPreview } from "./preview-history.js"
import { CLOSED_WORKBENCH, navigateFile, scopeWorkbench, showFile, showFileIndex } from "./workbench.js"
import type { PreviewTarget } from "./workbench.js"

const doc: PreviewTarget = { threadId: "a", cwd: "/w", path: "/w/docs/design.md", fragment: "方案", at: 1 }
const code: PreviewTarget = { threadId: "a", cwd: "/w", path: "/w/src/app.ts", line: 42, column: 3, at: 2 }

describe("文件阅读历史", () => {
  it("文档与代码可往返，行号与锚点保留，回退会重新触发定位", () => {
    const state = showFile(showFile(CLOSED_WORKBENCH, doc), code)
    const back = navigateFile(state, -1)
    expect(back.file).toEqual({ ...doc, at: 3 })
    expect(adjacentPreview(back.fileHistory, 1)).toEqual(code)
    expect(navigateFile(back, 1).file).toEqual({ ...code, at: 4 })
    expect(state.file).toEqual(code)
  })

  it("重复点击同一位置不占一页，退回后打开新目标会清除前进记录", () => {
    const state = showFile(showFile(CLOSED_WORKBENCH, doc), code)
    const again = showFile(state, { ...code, path: "src/app.ts", at: 3 })
    expect(again.fileHistory).toBe(state.fileHistory)
    const back = navigateFile(again, -1)
    const next = showFile(back, { ...code, line: 8 })
    expect(next.fileHistory?.forward).toEqual([])
    expect(next.fileHistory?.back).toHaveLength(1)
  })

  const invalid = [{ ...doc, threadId: "b" }, { ...doc, cwd: "/other" }]
  for (const next of invalid) it(`历史不跨任务或工作区：${next.threadId}/${next.cwd}`, () => {
    const state = showFile(showFile(CLOSED_WORKBENCH, doc), code)
    expect(showFile(state, next).fileHistory).toEqual({ back: [], forward: [] })
    const projected = scopeWorkbench(state, new Set(), next.threadId, next.cwd)
    expect(projected.fileHistory).toBeUndefined()
    expect(navigateFile(projected, -1)).toBe(projected)
  })

  it("返回文件列表结束本次阅读链，边界方向操作不改变选择", () => {
    const state = showFile(showFile(CLOSED_WORKBENCH, doc), code)
    const index = showFileIndex(state)
    expect(index.fileHistory).toBeUndefined()
    expect(navigateFile(index, -1)).toBe(index)
    expect(navigateFile(state, 1)).toBe(state)
  })

  it("最多保留 30 次，丢掉最早的阅读路径，不保留正文", () => {
    const chain = Array.from({ length: 40 }, (_, line) => ({ ...code, line: line + 1 }))
    const state = chain.reduce(showFile, CLOSED_WORKBENCH)
    expect(state.fileHistory?.back).toHaveLength(30)
    expect(state.fileHistory?.back[0]?.line).toBe(10)
    expect(visitPreview(undefined, undefined, doc)).toEqual({ back: [], forward: [] })
    expect(stepPreview(undefined, doc, -1)).toBeUndefined()
  })
})
