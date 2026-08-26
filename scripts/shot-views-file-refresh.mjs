export const FILE_REFRESH_VIEWS = [
  {
    name: "09-搜索持续刷新",
    createFiles: ["apps/desktop/src/renderer/attachment-live-refresh-probe.ts"],
    open: `(() => {
      window.__omniRefreshProbe = setInterval(() => {
        const found = [...document.querySelectorAll('.file-row')]
          .find(row => row.textContent.includes('attachment-live-refresh-probe.ts'))
        if (found === undefined) return
        found.scrollIntoView({ block: 'nearest' })
        clearInterval(window.__omniRefreshProbe)
        document.documentElement.dataset.fileRefresh = 'ready'
      }, 50)
      window.dispatchEvent(new Event('focus'))
    })()`,
    ready: "html[data-file-refresh=ready]",
    assert: `document.querySelector('.files-search input')?.value === 'attachment'
      && document.querySelector('.files-index') === window.__omniFileIndex
      && document.querySelector('.files-index')?.textContent.includes('attachment-live-refresh-probe.ts') === true
      && document.activeElement === window.__omniFileRow
      && document.activeElement?.matches('.file-row') === true`,
    after: `(() => {
      clearInterval(window.__omniRefreshProbe); delete window.__omniRefreshProbe
      delete document.documentElement.dataset.fileRefresh
      ;[...document.querySelectorAll('.file-row')]
        .find(row => row.textContent.includes('attachment-live-refresh-probe.ts'))?.click()
    })()`,
  },
  {
    name: "09-打开文件持续刷新",
    before: ".file-source",
    rewriteFiles: [{
      path: "apps/desktop/src/renderer/attachment-live-refresh-probe.ts",
      text: "export const refreshedWithoutFocus = true\n",
    }],
    open: `(() => {
      window.__omniPreviewSource = document.querySelector('.file-source')
      window.__omniPreviewPoll = setInterval(() => {
        const code = document.querySelector('.file-source code')
        if (!code?.textContent.includes('refreshedWithoutFocus')) return
        clearInterval(window.__omniPreviewPoll)
        document.documentElement.dataset.previewRefresh = 'ready'
      }, 50)
    })()`,
    ready: "html[data-preview-refresh=ready]",
    assert: `document.querySelector('.file-source') === window.__omniPreviewSource
      && document.querySelector('.file-source code')?.textContent.includes('refreshedWithoutFocus') === true
      && document.querySelector('.file-preview__status') === null`,
    after: `(() => {
      clearInterval(window.__omniPreviewPoll)
      delete window.__omniPreviewPoll
      delete window.__omniPreviewSource
      delete document.documentElement.dataset.previewRefresh
      document.querySelector('.file-preview .workbench__back')?.click()
    })()`,
  },
]
