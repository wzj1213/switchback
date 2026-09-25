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
   * 另验换家后第一句前面那条「历史交接」（换引擎自动交接默认开，样本见
   * `ui-fixture-handoff.mjs`）：它排在用户那句前面，「已处理」分界不能夹在两者之间。
   */
  name: "05b-换引擎留痕",
  open: null,
  ready: ".handmark",
  assert: `(() => {
    const mark = document.querySelector('.handmark')
    const tinted = [...document.querySelectorAll('.rail__mark')]
      .map(node => getComputedStyle(node).backgroundColor)
    const dot = document.querySelector('.row--selected .row__engine')
    // 换家后第一句前面的交接说明：换形态、标「历史交接」；「已处理」分界落在用户那句之后
    const note = [...document.querySelectorAll('.msg--native')]
      .find(node => node.querySelector('.msg__origin')?.textContent === '历史交接')
    const asked = [...document.querySelectorAll('.msg--user')]
      .find(node => node.textContent.includes('顺手把 throughput'))
    const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const split = [...document.querySelectorAll('.turnmark__row')].some(t => after(note, t) && after(t, asked))
    return mark?.textContent.includes('切换至 Codex') === true
      && mark.getAttribute('role') === 'separator'
      && new Set(tinted).size === 2
      && dot !== null
      && note !== undefined && asked !== undefined && after(note, asked) && !split
  })()`,
}
