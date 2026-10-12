/**
 * 「换引擎留痕」这一屏。从 `shot-views.mjs` 拆出来是行数闸门逼的；在 `VIEWS` 里的位置不变
 *（它沿用上一屏停在的主会话，挪到别处就不是同一屏了）。
 */
export const HANDOFF_VIEW = {
  /*
   * **换引擎在转录区里要留下痕迹。**
   *
   * 样本这条会话第二轮之前切去 codex 跑过（见 `ui-fixture.mjs` 的 `handedOff`）。
   * 不画的话，往回翻时「上面五问是谁答的、下面三问是谁答的」屏幕上一个字都没说。
   *
   * 三处同时验：转录区那条分界、左缘导航那一格的引擎色、侧栏行尾那颗引擎点。
   * 三处共用一套色（`engine-mark.ts`），对不上就连不成一句话。
   *
   * 另验换家后第一句前面的交接说明（换引擎自动交接默认开，样本见
   * `ui-fixture-handoff.mjs`）：它收进分界线成了「附交接说明」，默认收起、不再单独成一块；
   * 分界线排在用户那句前面，「已处理」分界不能夹在两者之间。
   */
  name: "05b-换引擎留痕",
  open: null,
  ready: ".handmark",
  assert: `(() => {
    const mark = document.querySelector('.handmark')
    const tinted = [...document.querySelectorAll('.rail__mark')]
      .map(node => getComputedStyle(node).backgroundColor)
    const dot = document.querySelector('.row--selected .row__engine')
    // 交接说明收进分界线：有「附交接说明」、默认收起、转录区里不再有单独那一块
    const brief = mark?.querySelector('.handmark__brief')
    const loose = [...document.querySelectorAll('.msg__origin')].some(node => node.textContent === '历史交接')
    const wrap = mark?.closest('.handmark-wrap')
    const asked = [...document.querySelectorAll('.msg--user')]
      .find(node => node.textContent.includes('顺手把 throughput'))
    const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const split = [...document.querySelectorAll('.turnmark__row')].some(t => after(wrap, t) && after(t, asked))
    return mark?.textContent.includes('切换至 Codex') === true
      && brief?.getAttribute('aria-expanded') === 'false'
      && document.querySelector('.handmark__text') === null
      && !loose
      && new Set(tinted).size === 2
      && dot !== null
      && wrap !== null && asked !== undefined && after(wrap, asked) && !split
  })()`,
}

/**
 * 点开「附交接说明」：原文在分界线下面展开，浅灰等宽小字、左侧细线，不是一张底色卡片。
 * 拍完收回去，后面的屏还是收起的样子。
 */
export const HANDOFF_OPEN_VIEW = {
  name: "05c-交接说明展开",
  open: [`document.querySelector('.handmark__brief')?.click()`],
  ready: ".handmark__text",
  assert: `(() => {
    const text = document.querySelector('.handmark__text')
    return document.querySelector('.handmark__brief')?.getAttribute('aria-expanded') === 'true'
      && text?.textContent.includes('switchback-handoff') === true
      && getComputedStyle(text).backgroundColor === 'rgba(0, 0, 0, 0)'
  })()`,
  after: `document.querySelector('.handmark__brief')?.click()`,
}
