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
    name: "04-历史审核拖放说明",
    open: [],
    dragFiles: ["apps/desktop/src/renderer/attachment-feedback.ts"],
    dragTarget: ".rv__pane",
    dragHint: "先继续会话",
    holdDrag: true,
    ready: ".composer-drop--surface",
    assert: `(() => {
      const hint = document.querySelector('.composer-drop--surface')?.getBoundingClientRect()
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
      return hint !== undefined && sidebar !== undefined
        && Math.abs(hint.left - sidebar.right) < 1 && Math.abs(hint.right - innerWidth) < 1
        && document.querySelector('.composer-drop--surface')?.textContent.includes('先继续会话') === true
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

/** 可编辑会话中的审核组必须和活动 / 文件组一样接住真实文件。 */
export const EDITABLE_REVIEW_VIEW = {
  name: "05-审核页也能接文件",
  open: [],
  shortcut: { key: "r", code: "KeyR", modifiers: 12, windowsVirtualKeyCode: 82 },
  dragFiles: ["apps/desktop/src/renderer/attachment-feedback.ts"],
  dragTarget: ".rv__pane",
  ready: ".composer__attachwarn",
  absent: ".rv",
  assert: `document.querySelector('.composer__input')?.value
      .includes('@apps/desktop/src/renderer/attachment-feedback.ts') === true
    && document.querySelector('.composer__attachwarn')?.textContent.includes('已引用 1 个文件') === true
    && document.activeElement?.classList.contains('composer__input') === true`,
  after: `(() => {
    const input = document.querySelector('.composer__input')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(input, '')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...document.querySelectorAll('.row--thread .row__main')]
      .find(row => row.textContent.includes('useFlow'))?.click()
  })()`,
}
