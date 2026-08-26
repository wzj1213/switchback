import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Item } from "@omni/protocol"
import { FileSearchStatus, FilesPage, visibleFileSearch, type FileSearchState } from "./FilesPage.js"

const cwd = "/work/repos"

const tool = (id: string, at: number, detail: Extract<Item, { kind: "tool_call" }>["detail"]): Item => ({
  id, turnId: "tn-1", kind: "tool_call", tool: "test", status: "ok", at, detail,
})

const items: readonly Item[] = [
  tool("r1", 1, { kind: "file_read", path: "/Users/me/.codex/skills/doc-manage/SKILL.md" }),
  tool("e1", 2, {
    kind: "file_edit",
    path: "order-service/src/main/java/com/example/shop/service/OrderBatchService.java",
    files: [{
      path: "order-service/src/main/java/com/example/shop/service/OrderBatchService.java",
      kind: "update", added: 12, removed: 1,
    }],
    added: 12,
    removed: 1,
  }),
]

function render(): string {
  return renderToStaticMarkup(createElement(FilesPage, {
    threadId: "th-1", cwd, items, target: undefined,
    onPick: () => undefined, onBack: () => undefined,
    onReveal: () => undefined, onCopy: () => undefined,
    searchFiles: () => Promise.resolve([]),
  }))
}

describe("文件清单", () => {
  it("按改过 / 读过分栏，名字在前、目录收成末两级", () => {
    const html = render()
    expect(html).toContain("这轮改过")
    expect(html).toContain("读过")
    expect(html).toContain("OrderBatchService.java")
    expect(html).toContain("…/shop/service")
    expect(html).toContain("SKILL.md")
    expect(html).toContain("…/skills/doc-manage")
    // 深目录不再整条铺开：截断会把文件名截掉
    expect(html).not.toContain("order-service/src/main/java/com/example/shop/service/OrderBatchService.java<")
  })

  it("工作区外的行标出来；工作区里的不标", () => {
    const html = render()
    expect(html).toContain("工作区外")
    expect(html.match(/工作区外/g)).toHaveLength(1)
  })

  it("查询或工作区变化后上一批结果立即失效", () => {
    const old: FileSearchState = {
      key: "/old\u0000readme", loading: false, paths: ["README.md"], failed: false,
    }
    expect(visibleFileSearch(old, "/new", "readme")).toEqual({ loading: true, paths: [], failed: false })
    expect(visibleFileSearch(old, "/old", "package")).toEqual({ loading: true, paths: [], failed: false })
    expect(visibleFileSearch(old, "/old", "readme")).toEqual({
      loading: false, paths: ["README.md"], failed: false,
    })
  })

  it("搜索失败不冒充零命中，并提供可聚焦的重试按钮", () => {
    const html = renderToStaticMarkup(createElement(FileSearchStatus, {
      state: { loading: false, paths: [], failed: true, retry: () => undefined },
    }))
    expect(html).toContain('role="alert"')
    expect(html).toContain("文件搜索失败，请重试。")
    expect(html).toContain(">重试</button>")
    expect(html).not.toContain("没有找到文件")
  })
})
