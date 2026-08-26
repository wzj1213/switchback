import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ReviewFile } from "../../shared/review.js"
import { ReviewList } from "./ReviewList.js"
import { reviewDestination } from "./review-navigation.js"

describe("审核文件键盘移动", () => {
  const cases = [
    ["ArrowDown", 0, 3, 1], ["ArrowDown", 2, 3, 0],
    ["ArrowUp", 2, 3, 1], ["ArrowUp", 0, 3, 2],
    ["Home", 2, 3, 0], ["End", 0, 3, 2],
    ["ArrowDown", -1, 3, 0], ["ArrowUp", -1, 3, 2],
    ["Enter", 1, 3, undefined], ["ArrowDown", 0, 0, undefined],
  ] as const
  for (const [key, at, total, expected] of cases) {
    it(`${key} · ${String(at)}/${String(total)} → ${String(expected)}`, () => {
      expect(reviewDestination(key, at, total)).toBe(expected)
    })
  }
})

describe("审核文件列表焦点", () => {
  it("只有当前行进入 Tab 顺序，筛选框和行声明方向键", () => {
    const files: readonly ReviewFile[] = [
      { path: "/repo/a.ts", rel: "a.ts", kind: "update", added: 1, removed: 0 },
      { path: "/repo/b.ts", rel: "b.ts", kind: "add", added: 2, removed: 0 },
    ]
    const html = renderToStaticMarkup(createElement(ReviewList, {
      files, active: "b.ts", query: "", ignored: [],
      onQuery: () => undefined, onPick: () => undefined,
    }))
    expect(html).toContain('aria-label="筛选文件" aria-keyshortcuts="ArrowUp ArrowDown Home End"')
    expect(html).toContain('data-review-rel="a.ts" tabindex="-1"')
    expect(html).toContain('data-review-rel="b.ts" tabindex="0"')
  })
})
