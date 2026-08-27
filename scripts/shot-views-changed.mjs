/**
 * 「这一轮改了哪些文件」那张卡，和左边那条导航。
 *
 * 单开一个文件是行数闸门逼的（`shot-views.mjs` 撑到了 303），这一刀也顺：
 * 这两样都要**先把内容摆到位**（切到某条会话、滚到某个位置）才看得见，
 * 那套摆场步骤和「转录区长什么样」不是一回事。
 */
export const CHANGED_VIEWS = [
    {
      /*
       * 一轮一张的改动卡。**卡跟着那一轮走，不是钉在最底下。**
       *
       * 断言盯三件事：卡的张数 = 有编辑的轮数（样本里两轮各改过文件）、
       * 每张都排在**下一轮的提问之前**（说明它属于自己那一轮）、
       * 而输入框上方那条状态带里**再也没有那张卡**（它从那儿搬回流里了）。
       */
      name: "01c-每轮的改动卡",
      open: `(() => {
        const cards = [...document.querySelectorAll('.edits')]
        const first = cards[0]
        first?.scrollIntoView({ block: 'center' })
      })()`,
      ready: ".edits",
      assert: `(() => {
        const cards = [...document.querySelectorAll('.transcript .edits')]
        if (cards.length !== 2) return false
        // 每张卡都在下一轮的提问之前：DOM 顺序即可判断
        const rows = [...document.querySelectorAll('.transcript__inner > *')]
        const at = (node) => rows.indexOf(node)
        const asks = [...document.querySelectorAll('.transcript .copyable[data-nav]')]
        if (asks.length !== 2) return false
        return at(cards[0]) < at(asks[1]) && at(cards[0]) > at(asks[0])
          && document.querySelector('.brief .edits') === null
          && document.querySelector('.brief .changed') === null
      })()`,
    },
    {
      /*
       * 左边那条导航。一格 = 你问的一次，悬停给出那句话。
       *
       * 用 `focus()` 而不是鼠标事件来唤起悬停卡：CDP 那边没有真实指针，
       * 而这条路本来就要为键盘用户留着（组件里 focus 与 hover 同一条线）。
       */
      name: "01d-提问导航条",
      // 正文列两边的空档放不下它时整条按设计不画（见 transcript-rail.css 的 container 查询）。
      // 最小窗口那一档正好在门槛下面，那时这一屏不该拍，也不该被当成回归
      // 注意是**算出来的 display**，不是 querySelector：容器查询把它 display:none 掉之后
      // 元素照样在 DOM 里，只判 `!== null` 等于没判
      only: `(() => {
        const rail = document.querySelector('.rail')
        return rail !== null && getComputedStyle(rail).display !== 'none'
      })()`,
      open: `true`,
      // 真把指针移上去：`:hover` 和 onMouseEnter 都只认真实指针事件（见 `hoverOver`）
      hover: ".rail__tick",
      ready: ".rail__peek",
      assert: `(() => {
        const ticks = [...document.querySelectorAll('.rail__tick')]
        const peek = document.querySelector('.rail__peek')
        const rail = document.querySelector('.rail')
        if (ticks.length !== 2 || peek === null || rail === null) return false
        // 整条只有一个 tab 停靠点：二三十轮的会话不该在 tab 序里塞三十个格子
        const stops = ticks.filter(tick => tick.tabIndex === 0).length
        // 格子按深浅排开，不能挤在同一个 y 上
        const ys = ticks.map(tick => Math.round(tick.getBoundingClientRect().top))
        return stops === 1 && ys[0] < ys[1]
          && peek.textContent.includes('useFlow')
      })()`,

    },
]
