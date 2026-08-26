import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { FilePreview } from "../../shared/file-preview.js"
import { canReferencePreview, canRevealPreview, FilePreviewView } from "./FilePreviewView.js"
import {
  fileCopyLabel,
  fileCopyTitle,
  htmlTabDestination,
  HtmlPreview,
  resolvedHtmlMode,
} from "./file-preview-content.js"

describe("文件预览操作", () => {
  const cases: readonly {
    name: string
    file: FilePreview | undefined
    path: string
    expected: boolean
  }[] = [
    { name: "正在读取的有效路径", file: undefined, path: "src/app.ts", expected: true },
    {
      name: "存在但不能预览的二进制",
      file: {
        kind: "unavailable",
        path: "logo.bin",
        name: "logo.bin",
        reason: "binary",
        message: "不能预览",
      },
      path: "logo.bin",
      expected: true,
    },
    {
      name: "已经缺失的文件",
      file: {
        kind: "unavailable",
        path: "gone.txt",
        name: "gone.txt",
        reason: "missing",
        message: "已经不存在",
      },
      path: "gone.txt",
      expected: false,
    },
    { name: "空路径", file: undefined, path: "", expected: false },
  ]

  for (const one of cases) {
    it(one.name, () => {
      expect(canRevealPreview(one.file, one.path)).toBe(one.expected)
      expect(canReferencePreview(one.file, one.path)).toBe(one.expected)
    })
  }

  it("后台读取不阻塞路径引用，只有会话只读或确认缺失才挡", () => {
    const html = renderToStaticMarkup(
      createElement(FilePreviewView, {
        target: { threadId: "thread", cwd: "/work", path: "src/app.ts" },
        revision: undefined,
        stamp: "idle:0",
        onBack: () => undefined,
        onReference: () => undefined,
        onReveal: () => undefined,
        onCopy: () => undefined,
      }),
    )
    const button = html.match(/<button[^>]+aria-label="引用到输入框"[^>]*>/)?.[0]
    expect(button).toBeDefined()
    expect(button).not.toContain("disabled")
  })

  it("会话只读时把恢复办法直接写在禁用操作上", () => {
    const html = renderToStaticMarkup(
      createElement(FilePreviewView, {
        target: { threadId: "thread", cwd: "/work", path: "src/app.ts" },
        revision: undefined,
        stamp: "idle:0",
        onBack: () => undefined,
        onReference: () => undefined,
        referenceDisabled: true,
        onReveal: () => undefined,
        onCopy: () => undefined,
      }),
    )
    expect(html).toContain("继续后引用")
    expect(html).toContain('aria-label="继续会话后引用到输入框"')
  })

  it("点开同名文件后仍把目录归属画在标题里，越界路径明确标记", () => {
    const render = (path: string, cwd = "/work/omni"): string =>
      renderToStaticMarkup(
        createElement(FilePreviewView, {
          target: { threadId: "thread", cwd, path },
          revision: undefined,
          stamp: "idle:0",
          onBack: () => undefined,
          onReveal: () => undefined,
          onCopy: () => undefined,
        }),
      )
    const inside = render("/work/omni/apps/desktop/src/index.ts")
    const external = render("/Users/me/.codex/skills/review/SKILL.md")
    const windows = render("c:\\Work\\Omni\\src\\App.ts", "C:\\work\\omni")
    expect(inside).toContain(">index.ts</strong>")
    expect(inside).toContain("…/desktop/src")
    expect(inside).not.toContain("工作区外")
    expect(external).toContain(">SKILL.md</strong>")
    expect(external).toContain("工作区外")
    expect(external).toContain("…/skills/review")
    expect(windows).toContain(">App.ts</strong>")
    expect(windows).toContain(">src</span>")
    expect(windows).not.toContain("工作区外")
  })
})

describe("HTML 预览模式", () => {
  const cases = [
    { picked: "preview", truncated: false, expected: "preview" },
    { picked: "source", truncated: false, expected: "source" },
    { picked: "preview", truncated: true, expected: "source" },
    { picked: "source", truncated: true, expected: "source" },
  ] as const

  for (const one of cases) {
    it(`${one.picked} · ${one.truncated ? "截断" : "完整"} → ${one.expected}`, () => {
      expect(resolvedHtmlMode(one.picked, one.truncated)).toBe(one.expected)
    })
  }

  const keys = [
    ["ArrowRight", "preview", false, "source"],
    ["ArrowLeft", "source", false, "preview"],
    ["Home", "source", false, "preview"],
    ["End", "preview", false, "source"],
    ["ArrowLeft", "source", true, "source"],
    ["Tab", "preview", false, undefined],
  ] as const

  for (const [key, mode, truncated, expected] of keys) {
    it(`${key} · ${mode} · 截断=${String(truncated)} → ${String(expected)}`, () => {
      expect(htmlTabDestination(key, mode, truncated)).toBe(expected)
    })
  }

  it("标签只保留一个 Tab 停点，并与正文面板建立可访问关联", () => {
    const file = {
      kind: "html",
      path: "report.html",
      name: "report.html",
      text: "<h1>报告</h1>",
      language: "html",
      truncated: false,
    } as const
    const html = renderToStaticMarkup(createElement(HtmlPreview, { file, onCopy: () => undefined }))
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toContain('aria-selected="true" tabindex="0"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain("aria-controls=")
    expect(html).toContain("aria-labelledby=")
  })

  it("源码滚动区进入键盘顺序并说明横向操作", () => {
    const file = {
      kind: "html",
      path: "large.html",
      name: "large.html",
      text: "<p>截断内容</p>",
      language: "html",
      truncated: true,
    } as const
    const html = renderToStaticMarkup(createElement(HtmlPreview, { file, onCopy: () => undefined }))
    expect(html).toContain('class="file-source" tabindex="0"')
    expect(html).toContain('class="file-source__toolbar"')
    expect(html).toContain('aria-label="可横向滚动的文件源码"')
    expect(html).toContain('title="只复制当前显示的前 1.5 MB"')
    expect(html).toContain("复制显示部分")
  })
})

describe("文件复制反馈", () => {
  const cases = [
    [false, false, "复制", "复制文件内容"],
    [true, false, "复制显示部分", "只复制当前显示的前 1.5 MB"],
    [false, true, "已复制", "文件内容已复制"],
    [true, true, "已复制显示部分", "当前显示的前 1.5 MB 已复制"],
  ] as const
  for (const [truncated, copied, label, title] of cases) {
    it(`截断=${String(truncated)} · 已复制=${String(copied)}`, () => {
      expect(fileCopyLabel(truncated, copied)).toBe(label)
      expect(fileCopyTitle(truncated, copied)).toBe(title)
    })
  }
})
