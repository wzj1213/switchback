export const FILE_REFRESH_VIEWS = [
  {
    name: "09-手动刷新立刻发现文件",
    createFiles: ["apps/desktop/src/renderer/attachment-manual-refresh-probe.ts"],
    open: `(() => {
      window.__switchbackManualRow = document.activeElement
      const beforeTop = window.__switchbackManualRow?.getBoundingClientRect().top
      const refresh = document.querySelector('[aria-label="立即刷新搜索结果"]')
      refresh?.focus()
      refresh?.click()
      window.__switchbackManualRefresh = refresh
      return new Promise(resolve => {
        const deadline = Date.now() + 1000
        const observe = () => {
          if (refresh?.getAttribute('aria-busy') !== 'true') {
            if (Date.now() >= deadline) {
              window.__switchbackManualLayout = { busy: 'never-started', sameTop: false, announced: false }
              resolve(true)
              return
            }
            setTimeout(observe, 5)
            return
          }
          window.__switchbackManualLayout = {
            busy: refresh.getAttribute('aria-busy'),
            sameTop: window.__switchbackManualRow?.getBoundingClientRect().top === beforeTop,
            announced: document.querySelector('.files-index [role="status"]')?.textContent
              .includes('正在更新搜索结果') === true,
          }
          resolve(true)
        }
        observe()
      })
    })()`,
    ready: '[data-file-path="apps/desktop/src/renderer/attachment-manual-refresh-probe.ts"]',
    assert: `(() => {
      const result = {
        query: document.querySelector('.files-search input')?.value,
        sameIndex: document.querySelector('.files-index') === window.__switchbackFileIndex,
        rowConnected: window.__switchbackManualRow?.isConnected,
        focusKept: document.activeElement === window.__switchbackManualRefresh,
        settled: window.__switchbackManualRefresh?.getAttribute('aria-busy'),
        ...window.__switchbackManualLayout,
      }
      if (result.query === 'attachment' && result.sameIndex && result.rowConnected
        && result.focusKept && result.settled === 'false' && result.busy === 'true'
        && result.sameTop && result.announced) return true
      throw new Error('手动刷新现场诊断：' + JSON.stringify(result))
    })()`,
    after: `(() => {
      window.__switchbackManualRow?.focus()
      delete window.__switchbackManualRow
      delete window.__switchbackManualRefresh
      delete window.__switchbackManualLayout
    })()`,
  },
  {
    name: "09-搜索持续刷新",
    createFiles: ["apps/desktop/src/renderer/attachment-live-refresh-probe.ts"],
    open: `(() => {
      window.__switchbackRefreshProbe = setInterval(() => {
        const found = [...document.querySelectorAll('.file-row')]
          .find(row => row.textContent.includes('attachment-live-refresh-probe.ts'))
        if (found === undefined) return
        found.scrollIntoView({ block: 'nearest' })
        clearInterval(window.__switchbackRefreshProbe)
        document.documentElement.dataset.fileRefresh = 'ready'
      }, 50)
      window.dispatchEvent(new Event('focus'))
    })()`,
    ready: "html[data-file-refresh=ready]",
    assert: `document.querySelector('.files-search input')?.value === 'attachment'
      && document.querySelector('.files-index') === window.__switchbackFileIndex
      && document.querySelector('.files-index')?.textContent.includes('attachment-live-refresh-probe.ts') === true
      && document.activeElement === window.__switchbackFileRow
      && document.activeElement?.matches('.file-row') === true`,
    after: `(() => {
      clearInterval(window.__switchbackRefreshProbe); delete window.__switchbackRefreshProbe
      delete document.documentElement.dataset.fileRefresh
      ;[...document.querySelectorAll('.file-row')]
        .find(row => row.textContent.includes('attachment-live-refresh-probe.ts'))?.click()
    })()`,
  },
  {
    name: "09-打开文件持续刷新",
    readyWithinMs: 2500,
    before: ".file-source",
    rewriteFiles: [{
      path: "apps/desktop/src/renderer/attachment-live-refresh-probe.ts",
      text: "export const refreshedWithoutFocus = true\n",
    }],
    open: `(() => {
      window.__switchbackPreviewSource = document.querySelector('.file-source')
      window.__switchbackPreviewPoll = setInterval(() => {
        const code = document.querySelector('.file-source code')
        if (!code?.textContent.includes('refreshedWithoutFocus')) return
        clearInterval(window.__switchbackPreviewPoll)
        document.documentElement.dataset.previewRefresh = 'ready'
      }, 50)
    })()`,
    ready: "html[data-preview-refresh=ready]",
    assert: `document.querySelector('.file-source') === window.__switchbackPreviewSource
      && document.querySelector('.file-source code')?.textContent.includes('refreshedWithoutFocus') === true
      && document.querySelector('.file-preview__status') === null`,
    after: `(() => {
      clearInterval(window.__switchbackPreviewPoll)
      delete window.__switchbackPreviewPoll
      delete document.documentElement.dataset.previewRefresh
    })()`,
  },
  {
    name: "09-刷新失败保留内容",
    before: ".file-source",
    chmodFiles: [{
      path: "apps/desktop/src/renderer/attachment-live-refresh-probe.ts",
      mode: 0o000,
    }],
    open: `(() => {
      const reload = document.querySelector('[aria-label="重新读取文件"]')
      reload?.focus()
      reload?.click()
    })()`,
    ready: ".file-preview__status--failed",
    assert: `document.querySelector('.file-source') === window.__switchbackPreviewSource
      && document.querySelector('.file-source code')?.textContent.includes('refreshedWithoutFocus') === true
      && document.querySelector('.file-preview__status--failed')?.textContent === '更新失败'
      && document.querySelector('.file-preview__status--failed')?.getAttribute('role') === 'status'
      && document.querySelector('[aria-label="重新读取文件"]')?.disabled === false
      && document.activeElement === document.querySelector('[aria-label="重新读取文件"]')`,
    after: `(() => {
      delete window.__switchbackPreviewSource
      document.querySelector('.file-preview .workbench__back')?.click()
    })()`,
  },
]
