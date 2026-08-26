/** Git 审核的编辑器组场景；单列出来，避免主视觉清单越过 300 行闸门。 */
export const REVIEW_VIEWS = [
  {
    name: "04-Git审核",
    open: [
      `document.querySelector('.rv__head .trigger')?.click()`,
      `[...document.querySelectorAll('.pop__item')]
        .find(button => button.textContent.includes('未提交'))?.click()`,
    ], shortcut: { key: "r", code: "KeyR", modifiers: 12, windowsVirtualKeyCode: 82 },
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
        const compact = window.innerWidth <= 1280
        const mainBox = main.getBoundingClientRect()
        return getComputedStyle(main).display === 'flex'
          && Math.abs(review.right - window.innerWidth) < 1
          && Math.abs(review.left - mainBox.right) < 1
          && (!compact || (getComputedStyle(document.querySelector('.sidebar')).display === 'none'
            && Math.abs(mainBox.left) < 1))
      })()
      && (() => {
        const review = document.querySelector('.rv')?.getBoundingClientRect()
        const title = document.querySelector('.panel-tab--on')?.getBoundingClientRect()
        const tools = document.querySelector('.rv__tools')?.getBoundingClientRect()
        const list = document.querySelector('.rvl')?.getBoundingClientRect()
        const pane = document.querySelector('.rv__pane')?.getBoundingClientRect()
        const buttons = [...document.querySelectorAll('.rv__tool')].map(button => button.getBoundingClientRect())
        if ([review, title, tools, list, pane].some(rect => rect === undefined)) return false
        const narrowHead = review.width <= 760
        const stackedBody = review.width <= 520
        const bodyAligned = stackedBody ? list.bottom <= pane.top + 1 : list.left >= pane.right - 1
        return (!narrowHead || tools.top >= title.bottom) && bodyAligned
          && buttons.every(button => button.height < 40 && button.width > 24)
      })()
      && document.querySelector('.rvd__body--split') === null
      && document.querySelector('[aria-label="切换到分栏差异"]') !== null
      && document.querySelectorAll('[role="treeitem"][aria-expanded]').length > 0
      && document.querySelectorAll('[role="treeitem"][data-review-rel]').length > 0
      && document.querySelectorAll('[role="treeitem"][tabindex="0"]').length === 1`,
  },
  {
    name: "04-审核范围菜单",
    open: `document.querySelector('.rv__head .trigger')?.click()`,
    ready: `[role="menu"][aria-label="选择审核范围"]`,
    assert: `(() => {
      const menu = document.querySelector('[role="menu"][aria-label="选择审核范围"]')
      const text = menu?.textContent ?? ''
      return ['上一轮', '未提交', '未暂存', '已暂存', '已提交', '分支']
        .every(label => text.includes(label))
        && document.activeElement?.getAttribute('role') === 'menuitemradio'
    })()`,
    after: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  },
  {
    name: "04-审核方向键不越界",
    open: `(() => {
      const before = document.querySelector('.rv__path')?.textContent
      const outside = document.querySelector('.sidebar__filter')
      outside?.focus()
      const outsideKey = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      outside?.dispatchEvent(outsideKey)
      const rows = [...document.querySelectorAll('.rvl__row--file')]
      const at = rows.findIndex(row => row.getAttribute('aria-current') === 'true')
      const expected = rows[(at + 1) % rows.length]?.getAttribute('data-review-rel')
      const input = document.querySelector('.rvl__input')
      input?.focus()
      const insideKey = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      input?.dispatchEvent(insideKey)
      window.__omniReviewKeys = {
        before, expected, outsidePreserved: document.querySelector('.rv__path')?.textContent === before,
        outsidePrevented: outsideKey.defaultPrevented, insidePrevented: insideKey.defaultPrevented,
      }
      return new Promise(resolve => requestAnimationFrame(() => resolve(true)))
    })()`,
    ready: ".rv__file",
    assert: `window.__omniReviewKeys?.outsidePreserved === true
      && window.__omniReviewKeys?.outsidePrevented === false
      && window.__omniReviewKeys?.insidePrevented === true
      && document.activeElement?.classList.contains('rvl__input') === true
      && document.querySelector('.rv__path')?.textContent === window.__omniReviewKeys?.expected`,
  },
  {
    name: "04-审核目录折叠",
    open: `(() => {
      const active = document.querySelector('[role="treeitem"][aria-current="true"]')?.getAttribute('data-review-rel')
      const dirs = [...document.querySelectorAll('[role="treeitem"][aria-expanded="true"]')]
      const target = dirs.find(row => !active?.startsWith(row.getAttribute('title') + '/'))
      window.__omniReviewTree = { path: target?.getAttribute('title'), before: document.querySelectorAll('[role="treeitem"]').length }
      target?.focus()
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    })()`,
    ready: `[role="treeitem"][aria-expanded="false"]`,
    assert: `(() => {
      const target = [...document.querySelectorAll('[role="treeitem"]')]
        .find(row => row.getAttribute('title') === window.__omniReviewTree?.path)
      return target?.getAttribute('aria-expanded') === 'false'
        && target === document.activeElement
        && document.querySelectorAll('[role="treeitem"]').length < window.__omniReviewTree?.before
    })()`,
    after: `document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
  },
  {
    name: "04-审核复制有确认",
    open: `(() => {
      const button = document.querySelector('[aria-label="复制这份文件改动"]')
      window.__omniReviewDiff = document.querySelector('.rvd')
      window.__omniReviewPath = document.querySelector('.rv__path')?.textContent
      button?.focus()
      button?.click()
    })()`,
    ready: '.rv__act[data-state="copied"]',
    assert: `(() => {
      const button = document.querySelector('.rv__act[data-state="copied"]')
      return button?.getAttribute('aria-label') === '文件改动已复制'
        && button === document.activeElement
        && document.querySelector('.rvd') === window.__omniReviewDiff
        && document.querySelector('.rv__path')?.textContent === window.__omniReviewPath
    })()`,
  },
  {
    name: "04-跳转到文件",
    open: [
      `document.querySelector('button[aria-label="跳转到文件"]')?.click()`,
      `(() => {
        const input = document.querySelector('input[aria-label="跳转到文件"]')
        window.__omniJumpInputFocused = document.activeElement === input
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'review')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
      `document.querySelector('input[aria-label="跳转到文件"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`,
    ],
    ready: `[role="dialog"][aria-label="跳转到文件"]`,
    assert: `(() => {
      const rows = [...document.querySelectorAll('[role="menu"][aria-label="匹配的审核文件"] .pop__item')]
      return window.__omniJumpInputFocused === true && rows.length > 0
        && rows.every(row => row.textContent.toLowerCase().includes('review'))
        && document.activeElement?.getAttribute('role') === 'menuitem'
    })()`,
    after: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  },
  {
    name: "04-分栏差异",
    open: `document.querySelector('[aria-label="切换到分栏差异"]')?.click()`,
    ready: `.rvd__body.rvd__body--split`,
    assert: `document.querySelector('.rvd')?.getAttribute('aria-label') === '并排文件改动，可滚动'
      && document.querySelector('[aria-label="切换到统一差异"]') !== null`,
    after: `document.querySelector('[aria-label="切换到统一差异"]')?.click()`,
  },
  {
    name: "04-隐藏审核文件",
    open: `document.querySelector('[aria-label="隐藏文件"]')?.click()`,
    ready: `.rv__body--list-hidden`,
    assert: `getComputedStyle(document.querySelector('.rvl')).display === 'none'
      && document.querySelector('[aria-label="显示文件"]') !== null`,
    after: `document.querySelector('[aria-label="显示文件"]')?.click()`,
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
      const compact = innerWidth <= 1280
      return hint !== undefined && sidebar !== undefined
        && Math.abs(hint.left - (compact ? 0 : sidebar.right)) < 1
        && Math.abs(hint.right - innerWidth) < 1
        && document.querySelector('.composer-drop--surface')?.textContent.includes('先继续会话') === true
    })()`,
  },
  {
    name: "04-Git审核展开",
    open: `document.querySelector('.rv .panel-tabs__expand')?.click()`,
    ready: `.shell--workbench-full .rv`,
    assert: `getComputedStyle(document.querySelector('.main')).display === 'none'
      && document.querySelector('.rv .panel-tabs__expand')?.getAttribute('aria-label') === '并排显示侧边面板'`,
    after: `[...document.querySelectorAll('.rv .panel-tab__close')]
      .find(button => button.getAttribute('aria-label') === '关闭审查页')?.click()`,
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
  assert: `(() => {
    const panelOpen = document.querySelector('.rv:not([hidden])') !== null
    return panelOpen === (innerWidth > 1120)
      && document.querySelector('.composer__input')?.value
        .includes('@apps/desktop/src/renderer/attachment-feedback.ts') === true
      && document.querySelector('.composer__attachwarn')?.textContent.includes('已引用 1 个文件') === true
      && document.activeElement?.classList.contains('composer__input') === true
  })()`,
  after: `(() => {
    const input = document.querySelector('.composer__input')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(input, '')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...document.querySelectorAll('.row--thread .row__main')]
      .find(row => row.textContent.includes('useFlow'))?.click()
  })()`,
}
