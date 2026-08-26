import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Item } from "@omni/protocol"
import { FileSearchStatus, FilesPage } from "./FilesPage.js"
import { beginFileSearch, visibleFileSearch, type FileSearchState } from "../use-file-search.js"

const cwd = "/work/repos"

const tool = (id: string, at: number, detail: Extract<Item, { kind: "tool_call" }>["detail"],
  options: { turnId?: string; inherited?: boolean } = {}): Item => ({
  id, turnId: options.turnId ?? "tn-1", kind: "tool_call", tool: "test", status: "ok", at, detail,
  ...(options.inherited === true ? { inherited: true as const } : {}),
})

const items: readonly Item[] = [
  tool("old", 0, { kind: "file_read", path: "README.md" }, { turnId: "tn-0" }),
  tool("parent", 0, { kind: "file_read", path: "parent.ts" }, { turnId: "parent", inherited: true }),
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
    threadId: "th-1", cwd, items, stamp: "idle:0", target: undefined,
    onPick: () => undefined, onBack: () => undefined,
    onReveal: () => undefined, onCopy: () => undefined,
    searchFiles: () => Promise.resolve([]),
  }))
}

describe("文件清单", () => {
  it("最近一轮、此前与继承历史分栏，名字在前、目录收成末两级", () => {
    const html = render()
    expect(html).toContain("最近一轮改过")
    expect(html).toContain("最近一轮读过")
    expect(html).toContain("此前碰过")
    expect(html).toContain("分支继承")
    expect(html).not.toContain(">这轮改过<")
    expect(html).toContain("OrderBatchService.java")
    expect(html).toContain("…/shop/service")
    expect(html).toContain("SKILL.md")
    expect(html).toContain("…/skills/doc-manage")
    expect(html).toContain('data-file-path="/work/repos/README.md"')
    // 深目录不再整条铺开：截断会把文件名截掉
    expect(html).not.toContain("order-service/src/main/java/com/example/shop/service/OrderBatchService.java<")
    expect(html.match(/class="file-row"[^>]*tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/class="file-row"[^>]*tabindex="-1"/g)).toHaveLength(3)
  })

  it("工作区外的行标出来；工作区里的不标", () => {
    const html = render()
    expect(html).toContain("工作区外")
    expect(html.match(/工作区外/g)).toHaveLength(1)
  })

  it("搜索框提供原位刷新，空查询时不会制造无意义请求", () => {
    const html = render()
    const button = html.match(/<button[^>]+aria-label="立即刷新搜索结果"[^>]*>/)?.[0]
    expect(button).toContain("disabled")
    expect(button).toContain('aria-busy="false"')
    expect(html).toContain('<label class="sr-only" for=')
    expect(html).toContain("搜索范围")
    expect(html).toContain('<bdi title="/work/repos">/work/repos</bdi>')
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

  it("同一查询后台重查保留旧结果，换关键词才清空", () => {
    const old: FileSearchState = {
      key: "/old\u0000readme", loading: false, paths: ["README.md"], failed: false,
    }
    expect(beginFileSearch(old, "/old\u0000readme")).toEqual({
      refresh: true,
      state: { ...old, loading: true },
    })
    expect(beginFileSearch(old, "/old\u0000package")).toEqual({
      refresh: false,
      state: { key: "/old\u0000package", loading: true, paths: [], failed: false },
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

  it("后台刷新只播报状态，不在结果流里插入可见行", () => {
    const html = renderToStaticMarkup(createElement(FileSearchStatus, {
      state: { loading: true, paths: ["src/app.ts"], failed: false, retry: () => undefined },
    }))
    expect(html).toContain('class="sr-only"')
    expect(html).toContain('role="status"')
    expect(html).toContain("正在更新搜索结果…")
    expect(html).not.toContain("files-search__refresh")
  })
})
