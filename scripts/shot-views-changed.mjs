/**
 * 「引擎报了 N 个文件」那张清单的验收屏。
 *
 * 单开一个文件是行数闸门逼的（`shot-views.mjs` 撑到了 303），这一刀也顺：
 * 这一屏要先切到一条**工作区不是 Git 仓库**的会话才有东西看，
 * 那套摆场步骤和「转录区长什么样」不是一回事。
 */
export const CHANGED_VIEWS = [
    {
      /*
       * 「引擎报了 N 个文件」那张清单。**它是浮层，不是这一行长高。**
       *
       * 要先切到那条 cwd 不是 Git 仓库的会话（`ui-fixture.mjs` 的 `noRepoThread`）：
       * 主样本的 cwd 是本仓库，引擎上报的那几条会被 git 核销掉，这张卡根本不出现。
       *
       * 断言盯三件事：展开前后**转录区高度一个像素都不变**、清单浮在摘要**上方**、
       * 而且整屏只有一张清单。上一版展开是就地摊开一张最高 36vh 的卡，
       * 正文当场缩掉三分之一——清单还没看完，上下文已经被挤没了。
       */
      name: "01c-编辑记录浮层",
      open: [
        // 那条会话的 cwd 不是本仓库，于是侧栏把它单列成一个**折着的**项目组
        `[...document.querySelectorAll('.sidebar button')]
          .find(row => row.textContent.includes('临时工作区'))?.click()`,
        // 侧栏那一行显示的是第一句人话（不是 thread.title），而且会截断——认「设计稿」就够
        `[...document.querySelectorAll('.row--thread .row__main')]
          .find(row => row.textContent.includes('设计稿'))?.click()`,
        `(() => {
          const bar = document.querySelector('.changed__summary')
          if (bar === null) throw new Error('这条会话没有出「引擎报了 N 个文件」那一条')
          const tall = document.querySelector('.transcript')?.getBoundingClientRect().height ?? 0
          document.documentElement.dataset.tallBefore = String(Math.round(tall))
          bar.click()
        })()`,
      ],
      ready: ".pop .changed__list",
      assert: `(() => {
        const before = Number(document.documentElement.dataset.tallBefore)
        const after = Math.round(document.querySelector('.transcript')?.getBoundingClientRect().height ?? -1)
        const pop = document.querySelector('.pop')?.getBoundingClientRect()
        const anchor = document.querySelector('.changed__summary')?.getBoundingClientRect()
        if (pop === undefined || anchor === undefined) return false
        return before === after && pop.bottom <= anchor.top
          && document.querySelectorAll('.changed__list').length === 1
          && document.querySelector('.changed__title')?.textContent.includes('引擎报了 2 个文件') === true
      })()`,
      after: `(() => {
        document.querySelector('.changed__summary')?.click()
        delete document.documentElement.dataset.tallBefore
        ;[...document.querySelectorAll('.row--thread .row__main')]
          // 侧栏这一行显示的是**原生标题**，不再是第一句话（见 sidebar.ts 的 rowLabelOf）
      .find(row => row.textContent.includes('订阅'))?.click()
      })()`,
    },
]
