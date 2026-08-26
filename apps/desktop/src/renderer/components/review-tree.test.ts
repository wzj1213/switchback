import { describe, expect, it } from "vitest"
import type { ReviewFile } from "../../shared/review.js"
import { revealReviewTreePath, reviewTreeDestination, reviewTreeRows } from "./review-tree-model.js"

const files: readonly ReviewFile[] = [
  { path: "/repo/apps/a.ts", rel: "apps/src/a.ts", kind: "update", added: 1, removed: 0 },
  { path: "/repo/apps/b.ts", rel: "apps/src/lib/b.ts", kind: "add", added: 2, removed: 0 },
  { path: "/repo/docs/a.md", rel: "docs/a.md", kind: "delete", added: 0, removed: 3 },
]

describe("审核文件目录树", () => {
  it("压缩单子目录，并让折叠目录隐藏后代", () => {
    const open = reviewTreeRows(files, new Set())
    expect(open.map((row) => row.label)).toEqual(["apps/src", "lib", "b.ts", "a.ts", "docs", "a.md"])
    expect(reviewTreeRows(files, new Set(["apps/src"])).map((row) => row.label))
      .toEqual(["apps/src", "docs", "a.md"])
  })

  it("切换到折叠目录里的文件时只展开它的祖先", () => {
    const closed = new Set(["apps/src", "docs"])
    expect([...revealReviewTreePath(closed, "apps/src/lib/b.ts")]).toEqual(["docs"])
    expect(revealReviewTreePath(closed, undefined)).toBe(closed)
  })

  it("方向键遵循树的展开、后代和父级关系", () => {
    const rows = reviewTreeRows(files, new Set())
    const cases = [
      ["ArrowDown", 0, 1], ["ArrowUp", 0, 0], ["Home", 4, 0], ["End", 0, 5],
      ["ArrowRight", 0, 1], ["ArrowLeft", 0, "toggle"], ["ArrowLeft", 2, 1],
      ["Enter", 1, undefined],
    ] as const
    for (const [key, at, expected] of cases) {
      expect(reviewTreeDestination(key, at, rows), `${key} @ ${String(at)}`).toBe(expected)
    }
    const closed = reviewTreeRows(files, new Set(["apps/src"]))
    expect(reviewTreeDestination("ArrowRight", 0, closed)).toBe("toggle")
  })
})
