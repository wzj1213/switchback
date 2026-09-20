import { openPanelPage } from "./shot-panel.mjs"

const filter = text => `(() => {
  const input = document.querySelector('.sidebar__filter')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
})()`
const many = `[...document.querySelectorAll('.row__count')].some(node => node.textContent === '503') ||
  document.querySelector('.sidebar__section--static')?.textContent.includes('504') === true`
const searchPages = '.project-pages[aria-label="搜索结果翻页"]'

export const SEARCH_VIEWS = [
  {
    name: "62-大量搜索结果按页显示", only: many,
    open: filter('历史会话'), ready: searchPages,
    assert: `document.querySelectorAll('.row--thread').length === 20 &&
      document.querySelector('${searchPages} span').textContent === '1–20 / 499' &&
      document.querySelector('.sidebar__section--static').textContent.includes('499 / 504')`,
  },
  {
    name: "63-搜索翻页不会展开全部", only: many,
    open: `document.querySelector('[aria-label="下一页搜索结果"]').click()`, ready: searchPages,
    assert: `document.querySelectorAll('.row--thread').length === 20 &&
      document.querySelector('${searchPages} span').textContent === '21–40 / 499' &&
      document.querySelector('.row--thread .row__label').textContent === '历史会话 24'`,
  },
  {
    name: "63a-改关键词回到列表顶部", only: many,
    open: [`document.querySelector('.sidebar__list').scrollTop = 180`, filter('历史')],
    ready: searchPages,
    assert: `document.querySelector('.sidebar__list').scrollTop === 0 &&
      document.querySelector('${searchPages} span').textContent === '1–20 / 499'`,
  },
  {
    name: "64-改关键词回到首批结果", only: many,
    open: filter('历史会话 500'), ready: '.sidebar__clear',
    assert: `document.querySelectorAll('.row--thread').length === 1 &&
      document.querySelector('.row--thread .row__label').textContent === '历史会话 500' &&
      document.querySelector('${searchPages}') === null`,
  },
  {
    name: "65-筛选清除按钮反馈",
    open: [filter('胶水'), `window.__omniSearchBox = document.querySelector('.row--search').getBoundingClientRect().width`],
    hover: '.sidebar__clear', ready: '.sidebar__clear',
    assert: `document.querySelector('.row--search').getBoundingClientRect().width === window.__omniSearchBox &&
      getComputedStyle(document.querySelector('.sidebar__clear')).backgroundColor !== 'rgba(0, 0, 0, 0)'`,
  },
  {
    name: "66-清除筛选回到项目",
    open: `document.querySelector('.sidebar__clear').click()`, ready: '.row--group',
    assert: `document.querySelector('.sidebar__filter').value === '' &&
      document.activeElement.matches('.sidebar__filter') && document.querySelector('.sidebar__clear') === null &&
      document.querySelector('.row--search').getBoundingClientRect().width === window.__omniSearchBox`,
    after: `delete window.__omniSearchBox`,
  },
  {
    name: "67-零结果也能清除",
    open: filter('omni-no-such-conversation-671902'), ready: '.sidebar__empty',
    assert: `document.querySelectorAll('.row--thread').length === 0 &&
      document.querySelector('.sidebar__empty').textContent.includes('没有匹配') &&
      document.querySelector('.sidebar__clear') !== null`,
  },
  {
    name: "68-键盘进入搜索结果",
    open: filter('胶水'), ready: '.row--thread',
    after: `document.querySelector('.sidebar__filter').focus()`,
  },
  {
    name: "69-方向键显示结果焦点",
    shortcut: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    open: `true`, ready: '.row--thread',
    assert: `document.activeElement.matches('.row--thread .row__main:focus-visible') &&
      document.activeElement.textContent.includes('胶水') && getComputedStyle(document.activeElement).outlineWidth === '2px'`,
  },
  {
    name: "70-正文搜索选中反馈",
    open: [filter('WINDOW_MS'), `document.querySelector('.deep__row')?.click()`],
    hover: '.deep__row', ready: '.deep__row--on',
    assert: `(() => {
      const row = document.querySelector('.deep__row--on'), css = getComputedStyle(row)
      const box = row.getBoundingClientRect(), head = document.querySelector('.row--search').getBoundingClientRect()
      return css.backgroundColor !== 'rgba(0, 0, 0, 0)' && box.left === head.left &&
        box.right <= head.right && row.textContent.includes('WINDOW_MS')
    })()`,
    after: `document.querySelector('.sidebar__clear').click()`,
  },
  {
    name: "71-中文输入保留方向键",
    open: [
      ...openPanelPage('文件'), filter('胶水'),
      `document.querySelector('.sidebar__filter').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', isComposing: true, bubbles: true, cancelable: true,
      }))`,
    ],
    ready: '.sidebar__clear',
    assert: `document.activeElement.matches('.sidebar__filter') &&
      document.querySelector('.sidebar__filter').value === '胶水'`,
  },
  {
    name: "72-清除筛选不关闭面板",
    shortcut: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    open: `true`, ready: '.row--group',
    assert: `document.querySelector('.sidebar__filter').value === '' &&
      document.activeElement.matches('.sidebar__filter') && document.querySelector('.workbench:not([hidden])') !== null`,
    after: `document.querySelector('.paneltoggle').click()`,
  },
  {
    name: "73-空白关键词保留项目列表",
    open: filter('   '), ready: '.row--group',
    assert: `document.querySelector('.sidebar__section--static') === null &&
      document.querySelectorAll('.row--thread').length <= 20`,
    after: `document.querySelector('.sidebar__clear').click()`,
  },
]
