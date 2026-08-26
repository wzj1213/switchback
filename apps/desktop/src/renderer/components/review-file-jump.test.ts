import { describe, expect, it } from "vitest"
import type { ReviewFile } from "../../shared/review.js"
import { filterReviewJumpFiles } from "./review-file-jump.js"

const files: readonly ReviewFile[] = [
  { path: "/repo/src/App.tsx", rel: "src/App.tsx", kind: "update", added: 1, removed: 0 },
  { path: "/repo/src/App.test.tsx", rel: "src/App.test.tsx", kind: "add", added: 2, removed: 0 },
  { path: "/repo/docs/guide.md", rel: "docs/guide.md", kind: "delete", added: 0, removed: 3 },
]

describe("审核文件跳转筛选", () => {
  const cases = [
    ["", ["src/App.tsx", "src/App.test.tsx", "docs/guide.md"]],
    ["APP", ["src/App.tsx", "src/App.test.tsx"]],
    ["src test", ["src/App.test.tsx"]],
    [" guide  ", ["docs/guide.md"]],
    ["missing", []],
  ] as const
  for (const [query, expected] of cases) {
    it(`${JSON.stringify(query)} → ${String(expected.length)} 个`, () => {
      expect(filterReviewJumpFiles(files, query).map((file) => file.rel)).toEqual(expected)
    })
  }
})
