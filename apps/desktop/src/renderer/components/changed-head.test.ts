import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ChangedHead } from "./changed-head.js"

describe("文件改动摘要的证据文案", () => {
  it("不会把 HEAD 脏状态或引擎旧记录冒充成本次对话净改动", () => {
    const cases = [
      ["baseline", "已编辑 1 个文件", "+3", "相对 HEAD"],
      ["head", "相关文件 1 个仍有改动", "相对 HEAD", "已编辑"],
      ["reported", "编辑记录 1 个文件", "未核实当前净值", "+3"],
    ] as const
    for (const [evidence, included, detail, excluded] of cases) {
      const html = renderToStaticMarkup(createElement(ChangedHead, {
        files: 1, others: 0, added: 3, removed: 1, failed: false, evidence, open: false,
        onOpen: () => undefined, onReview: () => undefined,
      }))
      expect(html).toContain(included)
      expect(html).toContain(detail)
      expect(html).not.toContain(excluded)
    }
  })
})
