const project = `[...document.querySelectorAll('.group')].find(group => group.querySelector('.row__label')?.textContent === 'omni')`
const filter = (text) => `(() => {
  const input = document.querySelector('input[aria-label="筛选会话"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`

/** 503 条项目会话验证懒挂载、翻页和搜索定位；不进入真实引擎。 */
export const SIDEBAR_VIEWS = [
  {
    name: "33-项目会话按需显示",
    open: `true`,
    ready: ".project-pages",
    assert: `(${project}).querySelectorAll('.row--thread').length === 20 &&
      (${project}).querySelector('.row__count').textContent === '503' &&
      (${project}).querySelector('.project-pages span').textContent === '1–20 / 503'`,
  },
  {
    name: "34-项目会话翻页",
    open: `(${project}).querySelector('[aria-label="下一页会话"]').click()`,
    ready: ".project-pages",
    assert: `(${project}).querySelectorAll('.row--thread').length === 20 &&
      (${project}).querySelector('.project-pages span').textContent === '21–40 / 503' &&
      !(${project}).textContent.includes('把订阅那段胶水抽成纯函数')`,
  },
  {
    name: "35-搜索定位未加载会话",
    open: [
      filter("历史会话 500"),
      `document.querySelector('.row--thread .row__main')?.click()`,
      filter(""),
    ],
    ready: ".project-pages",
    assert: `(${project}).querySelectorAll('.row--thread').length <= 20 &&
      (${project}).querySelector('.row--selected')?.textContent.includes('历史会话 500') &&
      (${project}).querySelector('.project-pages span').textContent === '501–503 / 503'`,
  },
  {
    name: "36-项目内拖到末尾",
    open: `true`,
    sidebarDrag: { from: "历史会话 500", to: "历史会话 502", edge: "after" },
    ready: ".project-pages",
    assert: `(() => {
      const rows = [...(${project}).querySelectorAll('.row--thread .row__label')].map(row => row.textContent)
      return rows.join(',') === '历史会话 501,历史会话 502,历史会话 500'
    })()`,
  },
  {
    name: "37-项目内向前排序",
    open: `true`,
    sidebarDrag: { from: "历史会话 500", to: "历史会话 501", edge: "before" },
    ready: ".project-pages",
    assert: `(${project}).querySelector('.row--thread .row__label').textContent === '历史会话 500'`,
  },
  {
    name: "38-置顶项目内排序",
    open: [
      `(${project}).querySelector('[aria-label="项目操作"]').click()`,
      `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes('置顶项目'))?.click()`,
    ],
    sidebarDrag: { from: "历史会话 500", to: "历史会话 502", edge: "after" },
    ready: ".sidebar__droppin .group",
    assert: `window.omni.settings().then(settings => {
      const order = Object.values(settings.threadOrder).find(ids => ids.length === 503)
      return settings.pinnedThreads.length === 0 && order?.at(-1) === 'th-page-500' &&
        document.querySelector('.sidebar__droppin .group .row__count').textContent === '503'
    })`,
  },
]
