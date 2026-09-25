import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { PanelPage } from "../panel-state.js"
import { PanelTabs } from "./PanelTabs.js"

function render(active: PanelPage): string {
  return renderToStaticMarkup(createElement(PanelTabs, {
    active, full: false, onSelect: () => undefined, onFull: () => undefined,
  }))
}

describe("侧边面板三页常驻", () => {
  const cases = [
    ["审查", "review"],
    ["文件", "files"],
    ["活动", "activity"],
  ] as const
  for (const [label, page] of cases) {
    it(`当前页是${label}`, () => {
      const html = render(page)
      // 三页都在，不管开没开过
      for (const [other] of cases) expect(html).toContain(`>${other}</span>`)
      // 只有当前那页标 aria-current
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
      expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>.*?${label}</span>`))
      // 不再有逐页关闭和「新建」菜单
      expect(html).not.toContain("关闭")
      expect(html).not.toContain("新建侧边页面")
    })
  }
})
