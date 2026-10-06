const project = `[...document.querySelectorAll('.group')].find(group => group.querySelector('.row__label')?.textContent === 'switchback')`
const section = title => `[...document.querySelectorAll('.sidebar__section-main')].find(button => button.textContent === '${title}')`
const filter = text => `(() => {
  const input = document.querySelector('.sidebar__filter')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`
const normal = '.group .row--thread:not(.row--selected)'

export const SELFCHECK_VIEWS = [
  {
    name: '74-搜索保留项目页码',
    open: [
      filter('胶水'), `document.querySelector('.row--thread .row__main').click()`, filter(''),
      `(${project}).querySelector('[aria-label="下一页会话"]').click()`,
      `document.querySelector('.sidebar__list').scrollTop = 180;
        window.__switchbackBrowseScroll = document.querySelector('.sidebar__list').scrollTop`,
      filter('胶水'), filter(''),
    ],
    ready: '.group .project-pages',
    assert: `(${project}).querySelector('.project-pages span').textContent === '21–40 / 503' &&
      (${project}).querySelectorAll('.row--thread').length === 20 &&
      Math.abs(document.querySelector('.sidebar__list').scrollTop - window.__switchbackBrowseScroll) < 1`,
    after: `delete window.__switchbackBrowseScroll`,
  },
  {
    name: '75-搜索保留分区折叠',
    open: [`(${section('项目')}).click()`, filter('胶水'), filter('')],
    ready: '.sidebar__dropproj',
    assert: `document.querySelector('.sidebar__dropproj .group') === null &&
      (${section('项目')}).getAttribute('aria-expanded') === 'false'`,
    after: `(${section('项目')}).click()`,
  },
  {
    name: '77-搜索打开折叠分区里的会话',
    open: [
      `(${section('项目')}).click()`, filter('胶水'),
      `document.querySelector('.row--thread .row__main').click()`, filter(''),
    ],
    ready: '.row--selected',
    assert: `(() => {
      const row = document.querySelector('.row--selected').getBoundingClientRect()
      const list = document.querySelector('.sidebar__list').getBoundingClientRect()
      return row.top >= list.top && row.bottom <= list.bottom &&
        (${project}).querySelector('.project-pages span').textContent === '1–20 / 503' &&
        (${section('项目')}).getAttribute('aria-expanded') === 'true'
    })()`,
  },
  {
    name: '76-滚动取消待弹出的会话预览',
    open: `document.querySelector('.group .row--thread .row__main').scrollIntoView({ block: 'center' })`,
    hover: '.group .row--thread .row__main',
    duringHover: `document.querySelector('.sidebar__list').scrollTop += 6`,
    hoverDelayMs: 650,
    ready: '.group .row--thread',
    assert: `document.querySelector('.peek') === null`,
  },
  {
    name: '78-重新悬停正常显示会话预览',
    open: `document.querySelector('.group .row--thread .row__main').scrollIntoView({ block: 'center' })`,
    hover: '.group .row--thread .row__main',
    hoverDelayMs: 650,
    ready: '.peek',
    assert: `(() => {
      const peek = document.querySelector('.peek'), rect = peek.getBoundingClientRect()
      peek.style.pointerEvents = 'auto'
      const hit = document.elementFromPoint(rect.left + 60, rect.top + 40)
      peek.style.removeProperty('pointer-events')
      return document.querySelectorAll('.peek').length === 1 && peek.contains(hit) &&
        rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
        peek.querySelector('.peek__title').textContent === document.querySelector('.group .row--thread .row__label').textContent
    })()`,
  },
  {
    name: '79-滚动收起已显示的会话预览',
    open: `document.querySelector('.group .row--thread .row__main').scrollIntoView({ block: 'center' })`,
    hover: '.group .row--thread .row__main',
    duringHover: `new Promise(resolve => setTimeout(resolve, 350)).then(() => {
      if (document.querySelector('.peek') === null) throw new Error('会话预览尚未显示')
      document.querySelector('.sidebar__list').scrollTop += 6
    })`,
    hoverDelayMs: 650,
    ready: '.group .row--thread',
    assert: `document.querySelector('.peek') === null`,
  },
  {
    name: '80-翻页清理待弹出的会话预览',
    open: `document.querySelector('.group .row--thread .row__main').scrollIntoView({ block: 'center' })`,
    hover: '.group .row--thread .row__main',
    duringHover: `(${project}).querySelector('[aria-label="下一页会话"]').click()`,
    hoverDelayMs: 650,
    ready: '.group .row--thread',
    assert: `document.querySelector('.peek') === null &&
      (${project}).querySelectorAll('.row--thread').length === 20`,
  },
  {
    name: '81-普通会话悬停日期可读',
    open: `document.querySelector('${normal} .row__main').scrollIntoView({ block: 'center' })`,
    hover: `${normal} .row__main`, ready: `${normal} .row__time`, audit: true,
    assert: `document.querySelector('${normal}').matches(':hover')`,
  },
  {
    name: '82-普通会话按下日期可读',
    open: `true`, hover: `${normal} .row__main`, press: true,
    ready: `${normal} .row__time`, audit: true,
    assert: `document.querySelector('${normal}').matches(':active')`,
  },
  {
    name: '83-项目悬停计数可读',
    open: `document.querySelector('.row--group').scrollIntoView({ block: 'center' })`,
    hover: '.row--group .row__main', ready: '.row--group .row__count', audit: true,
    assert: `document.querySelector('.row--group').matches(':hover')`,
  },
  {
    name: '84-正文搜索悬停摘要可读',
    open: [
      filter('历史会话 21'), `document.querySelector('.row--thread .row__main').click()`,
      filter('WINDOW_MS'),
      `return new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000
        const check = () => {
          if (document.querySelector('.deep__snip')?.textContent.includes('WINDOW_MS')) return resolve()
          if (Date.now() > deadline) return reject(new Error('正文搜索未完成'))
          setTimeout(check, 50)
        }
        check()
      })`,
    ],
    before: '.sidebar__filter', hover: '.deep__row:not(.deep__row--on)',
    ready: '.deep__row:not(.deep__row--on)', audit: true,
    assert: `document.querySelector('.deep__row:not(.deep__row--on)').matches(':hover')`,
  },
  {
    name: '85-正文搜索按下摘要可读',
    open: `true`, hover: '.deep__row:not(.deep__row--on)', press: true,
    ready: '.deep__snip', audit: true,
    assert: `document.querySelector('.deep__row:not(.deep__row--on)').matches(':active')`,
    after: filter(''),
  },
]
