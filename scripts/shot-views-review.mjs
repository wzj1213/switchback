/** Git 审核的编辑器组场景；单列出来，避免主视觉清单越过 300 行闸门。 */
export const REVIEW_VIEWS = [
  {
    name: "04-Git审核",
    open: [], shortcut: { key: "r", code: "KeyR", modifiers: 12, windowsVirtualKeyCode: 82 },
    ready: ".rv",
    assert: `(document.querySelector('.rv__file') !== null
        || document.querySelector('.rv')?.textContent.includes('当前工作区相对 HEAD 是干净的') === true)
      && !document.querySelector('.rv__pane')?.textContent.includes('读取当前净补丁失败')
      && document.querySelector('.rv__scrim') === null
      && (() => { const diff = document.querySelector('.rvd'); return diff === null
        || (diff.focus(), document.activeElement === diff) })()
      && (() => {
        const main = document.querySelector('.main')
        const review = document.querySelector('.rv')?.getBoundingClientRect()
        const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
        if (review === undefined || sidebar === undefined || main === null) return false
        const expectedMain = window.innerWidth > 1320
        return (getComputedStyle(main).display !== 'none') === expectedMain
          && Math.abs(review.right - window.innerWidth) < 1
          && (expectedMain || Math.abs(review.left - sidebar.right) < 1)
      })()
      && (() => {
        const review = document.querySelector('.rv')?.getBoundingClientRect()
        const title = document.querySelector('.rv__title')?.getBoundingClientRect()
        const tools = document.querySelector('.rv__tools')?.getBoundingClientRect()
        const buttons = [...document.querySelectorAll('.rv__seg')].map(button => button.getBoundingClientRect())
        if (review === undefined || title === undefined || tools === undefined) return false
        const stacked = review.width <= 760
        return (!stacked || tools.top >= title.bottom)
          && buttons.every(button => button.height < 40 && button.width > 24)
      })()`,
  },
  {
    name: "04-Git审核展开",
    open: `document.querySelector('.rv__expand')?.click()`,
    ready: `.shell--workbench-full .rv`,
    assert: `getComputedStyle(document.querySelector('.main')).display === 'none'
      && document.querySelector('.rv__expand')?.getAttribute('aria-label') === '并排显示审核'`,
    after: `document.querySelector('.rv__close')?.click()`,
  },
]
