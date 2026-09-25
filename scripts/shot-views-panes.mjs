import { openPanelPage } from "./shot-panel.mjs"

/** 外壳此刻三列的实际宽度。 */
const cols = `getComputedStyle(document.querySelector('.shell')).gridTemplateColumns.split(' ').map(parseFloat)`

/**
 * 在拖拽柄上走一遍按下—移动—松手。用合成的 PointerEvent：
 * 没有活的指针，`setPointerCapture` 会抛（代码里接住了），事件直接发给柄本身，一样走完拖动。
 */
function dragHandle(selector, dx) {
  return `(() => {
    const handle = document.querySelector('${selector}')
    const box = handle.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + 200
    const fire = (type, cx, buttons) => handle.dispatchEvent(new PointerEvent(type,
      { bubbles: true, pointerId: 7, button: 0, buttons, clientX: cx, clientY: y }))
    fire('pointerdown', x, 1)
    for (let i = 1; i <= 5; i++) fire('pointermove', x + ${dx} * i / 5, 1)
    fire('pointerup', x + ${dx}, 0)
  })()`
}

const reset = (selector) => `document.querySelector('${selector}')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`

/** 分栏拖拽：量外壳的真实列宽，结束时双击复位，不把拖出来的宽度留给后面的场景。 */
export const PANE_VIEWS = [
  {
    name: "74-拖动调整侧栏宽度",
    open: [`window.__panes = ${cols}`, dragHandle(".pane-handle--rail", 60)],
    ready: ".pane-handle--rail",
    assert: `(() => {
      const [rail] = ${cols}
      const handle = document.querySelector('.pane-handle--rail')
      return Math.abs(rail - window.__panes[0] - 60) < 1 && Number(handle.getAttribute('aria-valuenow')) === Math.round(rail)
        && getComputedStyle(handle).cursor === 'col-resize'
    })()`,
    after: reset(".pane-handle--rail"),
  },
  {
    name: "75-拖动调整面板宽度",
    // 窄窗里面板本来就只有下限那么宽、再宽就挤到对话，按设计拖不动
    only: `window.innerWidth >= 1200`,
    open: [...openPanelPage("审查"), `window.__panes = ${cols}`, dragHandle(".pane-handle--panel", -80)],
    ready: ".shell--workbench .pane-handle--panel",
    assert: `(() => {
      const [, main, panel] = ${cols}
      return Math.abs(panel - window.__panes[2] - 80) < 1 && main >= 420
    })()`,
    after: `${reset(".pane-handle--panel")}; document.querySelector('[aria-label="隐藏侧边面板"]')?.click()`,
  },
]
