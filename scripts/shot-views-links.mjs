const closeReview = `document.querySelector('.rv [aria-label="关闭审查页"]')?.click()`
const codeLink = `document.querySelector('.transcript a[href="apps/desktop/src/renderer/throughput.ts:8"]')`
const docLink = `document.querySelector('.transcript a[href="docs/.omni-link-probe.md"]')`
const closeFiles = `document.querySelector('.workbench [aria-label="关闭文件页"]')?.click()`

export const LINK_REVIEW_VIEWS = [
  {
    name: "01e-历史轮次准确打开补丁",
    open: [
      `(() => {
        const card = [...document.querySelectorAll('.edits')].at(-1)
        card?.scrollIntoView({ block: 'center' })
        const toggle = card?.querySelector('.edits__toggle')
        if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
      })()`,
      `[...document.querySelectorAll('.edits')].at(-1)?.querySelector('.changed__name')?.click()`,
    ],
    ready: '.rv .review-record',
    assert: `document.querySelector('.rv__path')?.textContent === 'apps/desktop/src/renderer/throughput.ts'
      && document.querySelector('.rvd')?.textContent.includes('WINDOW_MS = 3000') === true
      && document.querySelector('.rvd')?.textContent.includes('const WINDOW = 3000') === true
      && document.querySelector('.rv__title')?.textContent === '本轮改动'`,
  },
  {
    name: "01e-历史补丁复制反馈",
    open: `document.querySelector('[aria-label="复制这份文件改动"]')?.click()`,
    ready: '.rv__act[data-state="copied"]',
    assert: `document.querySelector('.rv__act[data-state="copied"]')?.getAttribute('aria-label') === '文件改动已复制'`,
  },
  {
    name: "01e-并排自动展开",
    open: `[...document.querySelectorAll('.rv__tools button')].find(button => button.textContent === '并排')?.click()`,
    ready: '.rvd__body--split',
    assert: `document.querySelectorAll('.rvd__cell').length > 0
      && document.querySelector('.rv__pane')?.getBoundingClientRect().width >= 420
      && document.querySelector('.rvd')?.scrollWidth <= document.querySelector('.rvd')?.clientWidth + 1`,
    after: `if (document.querySelector('.shell--workbench-full')) document.querySelector('.rv .panel-tabs__expand')?.click(); ${closeReview}`,
  },
  {
    name: "01e-未提供补丁可继续查看",
    open: [
      `(() => {
        const toggle = document.querySelector('.edits__toggle')
        if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
      })()`,
      `document.querySelector('.edits .changed__name')?.click()`,
    ],
    ready: '.review-unavailable',
    assert: `document.querySelector('.rv__path')?.textContent.endsWith('flow-scope.ts') === true
      && document.querySelector('.review-unavailable')?.textContent.includes('没有提供补丁') === true
      && document.querySelector('.review-unavailable')?.textContent.includes('预览当前文件') === true
      && document.querySelector('.rvd') === null`,
    after: closeReview,
  },
  {
    name: "01f-文件链接定位源码行",
    open: `${codeLink}?.click()`,
    ready: '.source-line[data-line="8"][data-selected="true"]',
    assert: `(() => {
      const row = document.querySelector('.source-line[data-selected="true"]')?.getBoundingClientRect()
      const box = document.querySelector('.file-source')?.getBoundingClientRect()
      return row !== undefined && box !== undefined && row.top >= box.top && row.bottom <= box.bottom
        && document.querySelector('.file-preview__title')?.textContent.includes('throughput.ts') === true
        && document.querySelector('.transcript code a[href="http://127.0.0.1:8766/"]')?.target === '_blank'
    })()`,
  },
  {
    name: "01f-重复点击重新定位",
    open: [`document.querySelector('.file-source').scrollTop = 5000`, `${codeLink}?.click()`],
    ready: '.source-line[data-line="8"][data-selected="true"]',
    assert: `document.querySelector('.file-source')?.scrollTop < 300`,
  },
  {
    name: "01f-Markdown文档预览",
    createFiles: ['docs/.omni-link-probe.md'],
    rewriteFiles: [{ path: 'docs/.omni-link-probe.md', text: '# 预览与跳转\n\n这份文档用于验证真实文件阅读。\n\n- [相对路径代码](../apps/desktop/src/renderer/throughput.ts:8)\n- [缺失文件](./.omni-missing-probe.txt)\n\n| 入口 | 行为 |\n| --- | --- |\n| 文件 | 侧栏预览 |\n| 网页 | 浏览器打开 |\n' }],
    open: `${docLink}?.click()`,
    ready: '.text-preview__document h1',
    assert: `document.querySelector('.text-preview__document h1')?.textContent === '预览与跳转'
      && document.querySelector('.text-preview__document table') !== null`,
  },
  {
    name: "01f-文档相对路径跳转",
    open: `document.querySelector('.text-preview__document a[href="../apps/desktop/src/renderer/throughput.ts:8"]')?.click()`,
    ready: '.source-line[data-line="8"][data-selected="true"]',
    assert: `document.querySelector('.file-preview__title')?.textContent.includes('throughput.ts') === true`,
  },
  {
    name: "01f-缺失文件有明确提示",
    open: [`${docLink}?.click()`, `document.querySelector('.text-preview__document a[href="./.omni-missing-probe.txt"]')?.click()`],
    ready: '.file-preview__body .workbench__empty',
    assert: `document.querySelector('.file-preview__body')?.textContent.includes('文件已经不存在') === true
      && document.querySelector('.file-source') === null
      && document.querySelector('[aria-label="重新读取文件"]')?.disabled === false`,
  },
  {
    name: "01f-大文件远行定位",
    createFiles: ['docs/.omni-source-probe.ts'],
    rewriteFiles: [{ path: 'docs/.omni-source-probe.ts', text: Array.from({ length: 50_000 }, (_, i) => `const n${i} = ${i}\n`).join('') }],
    open: `document.querySelector('.transcript a[href="docs/.omni-source-probe.ts:40000"]')?.click()`,
    ready: '.source-line[data-line="40000"][data-selected="true"]',
    assert: `(() => {
      const row = document.querySelector('.source-line[data-selected="true"]')
      const box = document.querySelector('.file-source')?.getBoundingClientRect()
      const rect = row?.getBoundingClientRect()
      return row?.textContent.includes('const n39999 = 39999') === true
        && document.querySelectorAll('.source-line').length < 250
        && rect !== undefined && box !== undefined && rect.top >= box.top && rect.bottom <= box.bottom
    })()`,
    after: `${closeFiles}; document.querySelectorAll('.edits__toggle[aria-expanded="true"]').forEach(button => button.click())`,
  },
]
