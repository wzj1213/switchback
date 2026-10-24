import { openPanelPage } from "./shot-panel.mjs"

function measure(selector) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    const box = node.getBoundingClientRect(), css = getComputedStyle(node)
    return { width: box.width, height: box.height, bg: css.backgroundColor, color: css.color, opacity: css.opacity }
  })()`
}

function baseline(selector) {
  return `window.__switchbackControl = ${measure(selector)}`
}

function feedback(selector, unchanged = false) {
  return `(() => {
    const before = window.__switchbackControl, after = ${measure(selector)}
    return before.width === after.width && before.height === after.height &&
      ${unchanged ? "before.bg === after.bg && before.color === after.color && before.opacity === after.opacity"
        : "before.bg !== after.bg && after.bg !== 'rgba(0, 0, 0, 0)'"}
  })()`
}

const preview = '.html-preview__switch button[aria-pressed="true"]'
const source = '.html-preview__switch button[aria-pressed="false"]'
const forward = '[aria-label="前进到下一个文件"]'
const row = '.row--selected'
const tab = '.rv:not([hidden]) .panel-tab--on'
const menu = '.pop__item:not(.pop__item--on)'
const escape = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`

/** 接在正文阅读场景之后，保留真实文件与页签，不构造假按钮。 */
export const INTERACTION_VIEWS = [
  {
    name: "46-工具按钮悬停不跳动",
    open: baseline('.paneltoggle'), hover: '.paneltoggle', ready: '.paneltoggle',
    assert: feedback('.paneltoggle'),
  },
  {
    name: "47-当前会话悬停保持选中",
    open: baseline(row), hover: `${row} .row__main`, ready: row,
    assert: `${feedback(row)} && getComputedStyle(document.querySelector('${row} .row__act')).opacity === '1'`,
  },
  {
    name: "48-键盘进入会话显露操作",
    shortcut: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    open: `document.querySelector('${row} .row__main').focus()`, hover: '.topbar', ready: row,
    assert: `(() => {
      const button = document.querySelector('${row} .row__main')
      return button.matches(':focus-visible') && getComputedStyle(button).outlineWidth === '2px' &&
        !button.closest('.row').matches(':hover') &&
        getComputedStyle(document.querySelector('${row} .row__act')).opacity === '1'
    })()`,
  },
  {
    name: "49-文档模式悬停统一",
    open: [...openPanelPage('文件'), baseline(source)], hover: source, ready: '.text-preview__document',
    assert: feedback(source),
    after: `window.__switchbackHover = getComputedStyle(document.querySelector('${source}')).backgroundColor`,
  },
  {
    name: "50-按下反馈区别于悬停",
    open: baseline(source), hover: source, press: true, ready: '.text-preview__document',
    assert: `${feedback(source)} && document.querySelector('${source}').matches(':active') &&
      getComputedStyle(document.querySelector('${source}')).backgroundColor !== window.__switchbackHover`,
  },
  {
    name: "51-禁用导航悬停保持静止",
    open: baseline(forward), hover: forward, ready: '.text-preview__document',
    assert: `${feedback(forward, true)} && document.querySelector('${forward}').disabled`,
  },
  {
    name: "52-文档选中模式悬停",
    open: baseline(preview), hover: preview, ready: '.text-preview__document', assert: feedback(preview),
  },
  {
    name: "53-面板页签悬停保持选中",
    open: [...openPanelPage('审查'), baseline(tab)], hover: `${tab} .panel-tab__pick`, ready: '.rv:not([hidden])',
    assert: feedback(tab),
  },
  {
    name: "53a-面板按钮按下反馈",
    open: [...openPanelPage('审查'), baseline('.rv .panel-tabs__button')],
    hover: '.rv .panel-tabs__button', press: true, ready: '.rv:not([hidden])',
    assert: `${feedback('.rv .panel-tabs__button')} && (() => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--bg-press)'
      document.body.append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      const button = document.querySelector('.rv .panel-tabs__button')
      return button.matches(':active') && getComputedStyle(button).backgroundColor === expected
    })()`,
  },
  {
    name: "54-菜单悬停反馈",
    open: [`document.querySelector('.rv:not([hidden]) .trigger').click()`, baseline(menu)],
    hover: menu, ready: '.pop__item', assert: feedback(menu),
  },
  {
    name: "55-菜单键盘焦点统一",
    shortcut: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    open: `true`, hover: '.topbar', ready: '.pop__item',
    assert: `document.activeElement.matches('.pop__item:focus-visible') &&
      getComputedStyle(document.activeElement).outlineWidth === '2px'`,
    after: escape,
  },
  {
    name: "56-设置选中项悬停",
    open: [
      `document.querySelector('.foot__who')?.click()`,
      `[...document.querySelectorAll('[role=menuitem]')].find(m => /设置|Settings/.test(m.textContent))?.click()`,
      baseline('.set__tab--on'),
    ],
    hover: '.set__tab--on', ready: '.set', assert: feedback('.set__tab--on'),
  },
  {
    name: "57-设置普通项悬停",
    open: baseline('.set__tab:not(.set__tab--on)'), hover: '.set__tab:not(.set__tab--on)', ready: '.set',
    assert: feedback('.set__tab:not(.set__tab--on)'),
    after: `${escape}; delete window.__switchbackControl; delete window.__switchbackHover`,
  },
  {
    name: "58a-操作按钮不叠加会话预览",
    open: `true`, hover: `${row} .row__act`, hoverDelayMs: 650, ready: row,
    assert: `document.querySelector('${row} .row__act').matches(':hover') && document.querySelector('.peek') === null`,
  },
  {
    name: "58-删除菜单保留危险反馈",
    open: [`document.querySelector('${row} .row__act').click()`, baseline('.pop__cmd--danger')],
    hover: '.pop__cmd--danger', ready: '.pop__cmd--danger', assert: feedback('.pop__cmd--danger'),
  },
  {
    name: "59-删除确认悬停可读",
    open: [`document.querySelector('.pop__cmd--danger').click()`, baseline('.row__act--danger')],
    hover: '.row__act--danger', ready: '.row__act--danger', assert: feedback('.row__act--danger'),
  },
  {
    name: "60-删除确认按下可读",
    open: baseline('.row__act--danger'), hover: '.row__act--danger', press: true, ready: '.row__act--danger',
    assert: `${feedback('.row__act--danger')} && document.querySelector('.row__act--danger').matches(':active')`,
    after: `document.querySelector('.row__act--danger')?.focus(); document.querySelector('.paneltoggle').focus();
      delete window.__switchbackControl`,
  },
]
