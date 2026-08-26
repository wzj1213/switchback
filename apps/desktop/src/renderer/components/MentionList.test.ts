import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MentionList, MentionStatus } from "./MentionList.js"
import { SlashList } from "./SlashList.js"

describe("@ 文件候选反馈", () => {
  it("加载、零命中与失败是三个不同状态", () => {
    const render = (loading: boolean, failed: boolean): string => renderToStaticMarkup(
      createElement(MentionStatus, { cwd: "/work/repos", loading, failed, onRetry: () => undefined }),
    )
    expect(render(true, false)).toContain("正在搜索工作区文件")
    expect(render(false, false)).toContain("没有匹配的工作区文件")
    const failed = render(false, true)
    expect(failed).toContain('role="alert"')
    expect(failed).toContain(">重试</button>")
  })

  it("候选列表保持文件语义与当前项", () => {
    const html = renderToStaticMarkup(createElement(MentionList, {
      cwd: "/work/repos", paths: ["src/a.ts", "docs/a.md"],
      active: 1, open: true, loading: false, failed: false,
      onPick: () => undefined, onRetry: () => undefined,
    }))
    expect(html).toContain('role="listbox"')
    expect(html).toContain('aria-label="工作区文件：/work/repos"')
    expect(html).toContain('<bdi title="/work/repos">/work/repos</bdi>')
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/role="option" tabindex="0"/g)).toHaveLength(1)
    expect(html.match(/role="option" tabindex="-1"/g)).toHaveLength(1)
  })

  it("文件与命令候选都留在输入框的虚拟焦点里", () => {
    const html = renderToStaticMarkup(createElement(SlashList, {
      commands: [{ name: "review", description: "审阅改动", source: "engine" }],
      query: "re", active: 0, onPick: () => undefined,
    }))
    expect(html).toContain('role="listbox"')
    expect(html).toContain('role="option" tabindex="0" aria-selected="true"')
  })
})
