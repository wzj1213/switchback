const project = `[...document.querySelectorAll('.group')].find(group => group.querySelector('.row__label')?.textContent === 'omni')`
const section = title => `[...document.querySelectorAll('.sidebar__section-main')].find(button => button.textContent === '${title}')`
const filter = text => `(() => {
  const input = document.querySelector('.sidebar__filter')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`

export const SELFCHECK_VIEWS = [
  {
    name: '74-搜索保留项目页码',
    open: [
      filter('胶水'), `document.querySelector('.row--thread .row__main').click()`, filter(''),
      `(${project}).querySelector('[aria-label="下一页会话"]').click()`,
      `document.querySelector('.sidebar__list').scrollTop = 180;
        window.__omniBrowseScroll = document.querySelector('.sidebar__list').scrollTop`,
      filter('胶水'), filter(''),
    ],
    ready: '.group .project-pages',
    assert: `(${project}).querySelector('.project-pages span').textContent === '21–40 / 503' &&
      (${project}).querySelectorAll('.row--thread').length === 20 &&
      Math.abs(document.querySelector('.sidebar__list').scrollTop - window.__omniBrowseScroll) < 1`,
    after: `delete window.__omniBrowseScroll`,
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
]
