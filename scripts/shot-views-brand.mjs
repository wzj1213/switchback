/**
 * 侧栏顶带（UI 重构 P1）：交通灯 · 品牌 · 侧栏开关和会话顶栏同高同中线；
 * 一条都没置顶时「置顶」段不画，拖动时落点浮出来、松手就置顶。
 */
export const BRAND_VIEWS = [
  {
    name: "61-品牌与导航对齐",
    open: `true`,
    ready: ".sidebar__wordmark",
    assert: `(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect()
      const mid = r => r.top + r.height / 2
      const head = box('.sidebar__head'), brand = box('.sidebar__brand'), mark = box('.sidebar__brand .switchback-mark')
      const toggle = box('.sidebar__head .iconbtn'), words = document.querySelector('.sidebar__wordmark')
      const title = box('.topbar'), panel = document.querySelector('.workbench:not([hidden]) .panel-tabs')?.getBoundingClientRect()
      const labels = ['.sidebar__new-label', '.row--group .row__label'].map(selector => box(selector).left)
      return head.height === title.height && Math.abs(mid(brand) - mid(title)) < 1 &&
        brand.left >= 78 && mark.width === 20 && mark.height === 20 &&
        toggle.right <= box('.sidebar').right && words.scrollWidth <= words.clientWidth &&
        Math.abs(labels[0] - labels[1]) < 1 && box('.sidebar__new').height === 36 &&
        (panel === undefined || panel.height === title.height)
    })()`,
  },
  {
    name: "39-拖到空置顶",
    open: `true`,
    // 样本里一条都没置顶：段不画；拖起来落点浮出，松手后这一段带着这条会话出现
    ready: ".row--thread",
    sidebarDrag: { from: "把订阅那段胶水抽成纯函数", toSelector: ".sidebar__droppin--float" },
    assert: `!!document.querySelector('.sidebar__droppin .row--thread') &&
      !document.querySelector('.sidebar__droppin--float')`,
  },
]
