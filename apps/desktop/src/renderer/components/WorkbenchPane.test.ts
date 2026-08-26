import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Thread } from "@omni/protocol"
import { WorkbenchPane } from "./WorkbenchPane.js"

const thread = {
  id: "thread", title: "任务", cwd: "/work", engine: "codex", trust: "auto-edit",
  status: "idle", createdAt: 1, updatedAt: 1, engineHistory: ["codex"],
} as Thread

function render(visible: boolean): string {
  return renderToStaticMarkup(createElement(WorkbenchPane, {
    state: { visible, page: "files" }, thread, lanes: [], items: [], stamp: "idle:0",
    onActivity: () => undefined, onFiles: () => undefined, onPickLane: () => undefined,
    onActivityIndex: () => undefined, onPickFile: () => undefined, onFileIndex: () => undefined,
    onHide: () => undefined, onReveal: () => undefined, onCopy: () => undefined,
    full: false, onFull: () => undefined,
    searchFiles: () => Promise.resolve([]),
  }))
}

describe("工作台页面保活", () => {
  it("收起时只隐藏外壳，活动与文件两页仍挂着等待恢复", () => {
    const html = render(false)
    expect(html).toContain('class="workbench"')
    expect(html).toContain("hidden")
    expect(html.match(/class="workbench__page"/g)).toHaveLength(2)
    expect(html).toContain('class="files-index"')
  })
})
