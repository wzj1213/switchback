/** 配合 shot-app --stress：验证上百轮记录的真实 DOM、搜索与大纲开销。 */
export const PERFORMANCE_VIEWS = [
  {
    name: "30-长会话分栏",
    open: [
      `document.querySelector('[aria-label="显示侧边面板"]')?.click()`,
      `(() => {
        const box = document.querySelector('.transcript')
        window.navScans = 0
        window.navQuery = box.querySelectorAll
        box.querySelectorAll = function(selector) {
          if (selector === '[data-nav]') window.navScans++
          return window.navQuery.call(this, selector)
        }
        for (let i = 0; i < 12; i++) setTimeout(() => {
          box.scrollTop -= 80
          box.dispatchEvent(new Event('scroll'))
        }, i * 20)
      })()`,
    ],
    ready: ".shell--workbench .md",
    assert: `window.navScans === 0 && document.querySelectorAll('[data-nav]').length === 240 &&
      document.querySelectorAll('.copyable[data-deferred]').length === 240`,
    after: `document.querySelector('.transcript').querySelectorAll = window.navQuery;
      document.querySelector('[aria-label="隐藏侧边面板"]')?.click()`,
  },
  {
    name: "31-长会话全文查找",
    open: `return window.switchback.find({ query: '历史查找标记-17', next: false, forward: true })
      .then(result => { window.historyMatches = result.total })`,
    ready: ".md",
    assert: `window.historyMatches > 0`,
    after: `window.switchback.stopFind()`,
  },
  {
    name: "32-长会话大纲跳转",
    only: `window.innerWidth > 960`,
    open: [
      `document.querySelector('[aria-label="隐藏侧边面板"]')?.click();
        document.querySelector('[aria-label="收起侧栏"]')?.click()`,
      `document.querySelector('.rail__tick')?.click()`,
    ],
    ready: ".rail__tick",
    assert: `document.querySelector('.transcript').scrollTop < 100 &&
      document.querySelectorAll('.rail__tick').length <= 32`,
    after: `document.querySelector('[aria-label="展开侧栏"]')?.click()`,
  },
]
