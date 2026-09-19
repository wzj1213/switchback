import { openPanelPage } from "./shot-panel.mjs"

const hide = `([...document.querySelectorAll('[aria-label="收起侧边面板"], [aria-label="隐藏侧边面板"]')]
  .find(button => button.getClientRects().length > 0))?.click()`
const documentPath = "docs/omni-panel-reading-probe.md"

export const PANEL_SIZING_VIEWS = [
  {
    name: "40-右栏默认阅读宽度",
    open: openPanelPage("审查"),
    ready: ".shell--workbench .rv:not([hidden])",
    assert: `(() => {
      const panel = document.querySelector('.rv:not([hidden])')
      const rect = panel.getBoundingClientRect()
      const main = document.querySelector('.main')
      const close = panel.querySelector('[aria-label="收起侧边面板"]')
      return rect.width >= 559 && rect.right <= window.innerWidth + 1 &&
        (getComputedStyle(main).display !== 'none' || close.getClientRects().length > 0)
    })()`,
    after: hide,
  },
  {
    name: "41-右栏文档正文自适应",
    createFiles: [documentPath],
    rewriteFiles: [{ path: documentPath, text: "# 面板中的阅读\n\n正文和代码随面板宽度排版。\n\n" +
      "很长的路径/".repeat(50) + "\n\n```text\n" + "long_readable_line_".repeat(40) + "\n```\n" }],
    open: [
      ...openPanelPage("文件"),
      `document.querySelector('[aria-label="返回文件列表"]')?.click()`,
      `(() => {
        const input = document.querySelector('.files-search input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'omni-panel-reading-probe')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
      `return new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000
        const timer = setInterval(() => {
          const row = document.querySelector('[data-file-path="${documentPath}"]')
          if (row) { clearInterval(timer); row.click(); resolve(true) }
          else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('未找到阅读样本')) }
        }, 50)
      })`,
    ],
    ready: ".text-preview__document h1",
    assert: `(() => {
      const body = document.querySelector('.text-preview__document')
      const code = body.querySelector('pre')
      const panel = document.querySelector('.workbench:not([hidden])').getBoundingClientRect()
      return body.scrollWidth <= body.clientWidth + 1 && code.scrollWidth <= code.clientWidth + 1 &&
        body.getBoundingClientRect().right <= panel.right && body.clientHeight > 250
    })()`,
  },
  {
    name: "42-窄窗可收起并恢复阅读",
    open: [hide, `document.querySelector('[aria-label="显示侧边面板"]')?.click()`],
    ready: ".workbench:not([hidden]) .text-preview__document h1",
    assert: `document.querySelector('.text-preview__document h1').textContent === '面板中的阅读'`,
    after: hide,
  },
  {
    name: "43-多个页签时收起整个面板",
    open: [...openPanelPage("审查"), hide],
    ready: ".shell:not(.shell--workbench)",
    assert: `document.querySelector('.main').getBoundingClientRect().width > 600`,
  },
]
