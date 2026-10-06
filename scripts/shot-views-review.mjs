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
        // 干净树：认「清单说了没有改动」这个**结构事实**，不认某一句具体文案。
        // 原来钉的是「当前工作区相对 HEAD 是干净的」，而这一屏自己点了「未提交」，
        // 那个范围下 review-empty.tsx 说的是「未提交没有改动」——两句都对，
        // 钉死一句的结果是：一棵干净的树在这一屏必然失败。
        || document.querySelector('.rvl__none') !== null)
      // 失败态只看**那个专门的元素**，不扫整块面板的文字。
      // 原来扫的是 .rv__pane 的 textContent，而它包含**正在展示的那份 diff 正文**——
      // 于是这一屏在「被审核的文件恰好含有这个字符串」时必然失败，
      // 而含有它的文件正是这个断言自己所在的那一份。实测复现过。
      // 顺带：原来找的那句话（「读取当前净补丁失败」）压根不会出现在面板里，
      // 它是**复制**动作的兜底文案（review-patch.ts 的 SKIP_COPY）；
      // 面板真正会说的是 ReviewDiff.tsx 的 SKIP。
      && [...document.querySelectorAll('.rvd__note')]
        .every(note => !note.textContent.includes('读取这份改动失败'))
      && document.querySelector('.rv__scrim') === null
      && (() => { const diff = document.querySelector('.rvd'); return diff === null
        || (diff.focus(), document.activeElement === diff) })()
      && (() => {
        const main = document.querySelector('.main')
        const review = document.querySelector('.rv')?.getBoundingClientRect()
        const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
        if (review === undefined || sidebar === undefined || main === null) return false
        const mainBox = main.getBoundingClientRect()
        return Math.abs(review.right - window.innerWidth) < 1 && sidebar.width > 100
          && review.width >= 279 && review.width <= 560 && getComputedStyle(main).display === 'flex'
          && mainBox.width > review.width && mainBox.width >= 350
          && Math.abs(review.left - mainBox.right) < 1 && Math.abs(mainBox.left - sidebar.right) < 1
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
        const stackedBody = review.width <= 760
        const bodyAligned = stackedBody ? list.bottom <= pane.top + 1 : list.left >= pane.right - 1
        return (!narrowHead || tools.top >= title.bottom) && bodyAligned
          && buttons.every(button => button.height < 40 && button.width > 24)
      })()
      && document.querySelector('.rvd__body--split') === null
      && (() => {
        /*
         * **并排按钮两种长相都合法，认的是「它说的和它的状态一致」。**
         *
         * 补丁区放不下两列时它置灰，并把理由写进 aria-label
         *（闸门见 use-narrow-panel.ts 的 SPLIT_MIN_W）。而这一屏的面板只有
         * 300px、里面还站着 260px 的文件清单——**这一档正是它该灰的那一档**。
         * 钉死「切换到分栏差异」必然失败，钉死置灰又会在展开态失败。
         */
        const split = document.querySelector('[aria-label="切换到分栏差异"], [aria-label^="补丁区放不下两列"]')
        if (split === null) return false
        return split.disabled === split.getAttribute('aria-label').startsWith('补丁区放不下两列')
      })()
      && (() => {
        /*
         * **目录树的断言只在真有改动文件时才成立。**
         *
         * 上面那段已经允许「工作区相对 HEAD 是干净的」这一种结局，
         * 但这三条无条件要求树里有节点——于是**在一棵干净的树上出图必然失败**，
         * 而「界面改动的唯一验收方式」因此在最常见的那个状态下跑不起来
         *（改完样式、还没动业务文件的时候，树正好是干净的）。
         */
        const files = document.querySelectorAll('[role="treeitem"][data-review-rel]')
        if (files.length === 0) return document.querySelector('.rvl__none') !== null
        return document.querySelectorAll('[role="treeitem"][aria-expanded]').length > 0
          && document.querySelectorAll('[role="treeitem"][tabindex="0"]').length === 1
      })()`,
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
    /*
     * 方向键不越界。
     *
     * **断言只钉不变量，不钉具体落到哪一份。** 原来写的是
     * `rows[(at + 1) % rows.length]`——那是给**扁平清单**算的，
     * 而文件栏早就改成了可折叠目录树：折起来的目录里那些文件根本不在
     * `.rvl__row--file` 里，于是「下一份」按渲染行算出来的和键盘按模型走到的
     * 不是同一个，出图在真实工作区上必然失败（14 份改动、四层目录时实测复现）。
     *
     * 现在要的是两件事：面板外面按方向键选中不变；面板里面按下去要被吃掉、
     * 焦点留在筛选框、并且**换到了另一份确实存在的文件**。
     */
    name: "04-审核方向键不越界",
    open: `(() => {
      const before = document.querySelector('.rv__path')?.textContent
      const outside = document.querySelector('.sidebar__filter')
      outside?.focus()
      const outsideKey = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      outside?.dispatchEvent(outsideKey)
      const known = [...document.querySelectorAll('.rvl__row--file')]
        .map(row => row.getAttribute('data-review-rel'))
      const input = document.querySelector('.rvl__input')
      input?.focus()
      const insideKey = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      input?.dispatchEvent(insideKey)
      window.__switchbackReviewKeys = {
        before, known, outsidePreserved: document.querySelector('.rv__path')?.textContent === before,
        outsidePrevented: outsideKey.defaultPrevented, insidePrevented: insideKey.defaultPrevented,
      }
      return new Promise(resolve => requestAnimationFrame(() => resolve(true)))
    })()`,
    ready: ".rv__file",
    assert: `(() => {
      const keys = window.__switchbackReviewKeys
      const now = document.querySelector('.rv__path')?.textContent
      // 越界那半：面板外面按方向键，选中的文件一个字都不能变
      if (keys?.outsidePreserved !== true || keys.outsidePrevented !== false) return false
      // 面板里面那半：必须吃掉这次按键，焦点留在筛选框，并且真的换了一份文件
      // 只有一份改动文件时，「下一份」就是它自己——这时不该要求选中变了。
      // 这条第一次写出来就漏了它，而工作区只改一个文件恰恰是最常见的情形。
      const moved = keys.known.length > 1 ? now !== keys.before : now === keys.before
      return keys.insidePrevented === true
        && document.activeElement?.classList.contains('rvl__input') === true
        && moved
        && keys.known.includes(now)
    })()`,
  },
  {
    name: "04-审核目录折叠",
    open: `(() => {
      const active = document.querySelector('[role="treeitem"][aria-current="true"]')?.getAttribute('data-review-rel')
      const dirs = [...document.querySelectorAll('[role="treeitem"][aria-expanded="true"]')]
      const outside = dirs.find(row => !active?.startsWith(row.getAttribute('title') + '/'))
      // 优先挑**不含当前文件**的目录（折起来不动选中，更干净）；工作区只改了
      // 一份文件时这样的目录根本不存在，那就退回任意一个展开的目录——
      // 这一屏验的是「折起来之后节点变少、焦点还在原行」，两种情形都成立。
      // 不退的话 target 是 undefined，什么都不折，ready 直接超时。
      const target = outside ?? dirs[0]
      window.__switchbackReviewTree = { path: target?.getAttribute('title'), before: document.querySelectorAll('[role="treeitem"]').length }
      target?.focus()
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    })()`,
    ready: `[role="treeitem"][aria-expanded="false"]`,
    assert: `(() => {
      const target = [...document.querySelectorAll('[role="treeitem"]')]
        .find(row => row.getAttribute('title') === window.__switchbackReviewTree?.path)
      return target?.getAttribute('aria-expanded') === 'false'
        && target === document.activeElement
        && document.querySelectorAll('[role="treeitem"]').length < window.__switchbackReviewTree?.before
    })()`,
    after: `document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`,
  },
  {
    name: "04-审核复制有确认",
    open: `(() => {
      const button = document.querySelector('[aria-label="复制这份文件改动"]')
      window.__switchbackReviewDiff = document.querySelector('.rvd')
      window.__switchbackReviewPath = document.querySelector('.rv__path')?.textContent
      button?.focus()
      button?.click()
    })()`,
    ready: '.rv__act[data-state="copied"]',
    assert: `(() => {
      const button = document.querySelector('.rv__act[data-state="copied"]')
      return button?.getAttribute('aria-label') === '文件改动已复制'
        && button === document.activeElement
        && document.querySelector('.rvd') === window.__switchbackReviewDiff
        && document.querySelector('.rv__path')?.textContent === window.__switchbackReviewPath
    })()`,
  },
  {
    /*
     * 查询词从真实清单里取，不写死。
     *
     * 原来写死 "review"，于是这一屏能不能过取决于**出图那一刻开发者工作区里
     * 改了哪些文件**：改的全是 styles/tokens.css 这类路径时，过滤结果为空，
     * rows.length > 0 直接失败。现在拿第一份改动文件的文件名当查询词——
     * 它必然至少命中自己，干净树则退化成「只验输入框拿到了焦点」。
     *
     * **注意里面那几步是模板字符串，不是代码。** 说明只能写在这儿：
     * 写进模板里的话，注释里的反引号会把字符串提前收尾。这一条踩过一次。
     */
    name: "04-跳转到文件",
    open: [
      `document.querySelector('button[aria-label="跳转到文件"]')?.click()`,
      `(() => {
        const input = document.querySelector('input[aria-label="跳转到文件"]')
        window.__switchbackJumpInputFocused = document.activeElement === input
        const first = document.querySelector('[role="menu"][aria-label="匹配的审核文件"] .pop__label')
        const rel = first?.getAttribute('title') ?? ''
        const term = (rel.split('/').pop() ?? '').slice(0, 6)
        window.__switchbackJumpTerm = term
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, term)
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
      `document.querySelector('input[aria-label="跳转到文件"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`,
    ],
    ready: `[role="dialog"][aria-label="跳转到文件"]`,
    assert: `(() => {
      const rows = [...document.querySelectorAll('[role="menu"][aria-label="匹配的审核文件"] .pop__item')]
      const term = (window.__switchbackJumpTerm ?? '').toLowerCase()
      // 干净树没有可跳转的文件，这一屏拍的就是空清单——不该因此判失败
      if (term === '') return window.__switchbackJumpInputFocused === true
      return window.__switchbackJumpInputFocused === true && rows.length > 0
        && rows.every(row => row.textContent.toLowerCase().includes(term))
        && document.activeElement?.getAttribute('role') === 'menuitem'
    })()`,
    after: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  },
  {
    name: "04-分栏差异",
    // 以实际补丁宽度决定是否支持并排，窄面板的文件列表放在上方。
    only: `(() => {
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0
      const panel = window.innerWidth - sidebar
      return (panel <= 760 ? panel : panel - 261) >= 420
    })()`,
    // 手动展开后切并排，默认面板给主对话保留更多宽度。
    open: [
      `(() => { const button = document.querySelector('.rv .panel-tabs__expand');
        if (button?.getClientRects().length) button.click() })()`,
      `document.querySelector('[aria-label="切换到分栏差异"]')?.click()`,
    ],
    ready: `.rvd__body.rvd__body--split`,
    assert: `document.querySelector('.rvd')?.getAttribute('aria-label') === '并排文件改动，可滚动'
      && document.querySelector('[aria-label="切换到统一差异"]') !== null
      && document.querySelectorAll('.rvd__row:not(.rvd__row--full) .rvd__sign').length > 0`,
    after: `document.querySelector('[aria-label="切换到统一差异"]')?.click();
      (() => { const button = document.querySelector('.rv .panel-tabs__expand');
        if (button?.getClientRects().length) button.click() })()`,
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
    // 三页常驻，没有逐页关闭键了：直接收起整个面板（同时退出独占），后面的场景从主对话起步。
    // 不用 Esc——文件页开过时 Esc 只关审查页、面板仍独占，主区还是藏着的
    after: `document.querySelector('[aria-label="隐藏侧边面板"]')?.click()`,
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
      && document.querySelector('.dblock')?.title === 'apps/desktop/src/renderer/attachment-feedback.ts'
      && document.querySelector('.composer__input')?.value === ''
      && document.querySelector('.composer__attachwarn')?.textContent.includes('已引用 1 个文件') === true
      && document.activeElement?.classList.contains('composer__input') === true
  })()`,
  after: `(() => {
    const input = document.querySelector('.composer__input')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(input, '')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    for (const x of document.querySelectorAll('.dblock__x')) x.click()
    ;[...document.querySelectorAll('.row--thread .row__main')]
      // 侧栏这一行显示的是**原生标题**，不再是第一句话（见 sidebar.ts 的 rowLabelOf）
      .find(row => row.textContent.includes('订阅'))?.click()
  })()`,
}
