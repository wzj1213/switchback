/** 把固定样本点开；反复确认展开态，扛住启动期侧栏的异步重绘。 */
export async function openFixture({ value, waitFor, pause }, cdp) {
  const group = `[...document.querySelectorAll('.row--group')].find(row => row.querySelector('.row__label')?.textContent.trim() === 'omni')`
  await waitFor(cdp, `${group}?.querySelector('.row__main') !== null`, "项目组")
  const deadline = Date.now() + 20_000
  let selected = false
  while (!selected) {
    if (Date.now() >= deadline) throw new Error("界面没有就绪（会话列表）")
    if (!(await value(cdp, `${group}?.querySelector('.chev--open') !== null`))) {
      await value(cdp, `${group}?.querySelector('.row__main')?.click(); true`)
    }
    selected = await value(cdp, `(() => {
      const row = document.querySelector('.row--thread .row__main')
      if (row === null) return false
      row.click()
      return true
    })()`)
    await pause(120)
  }
  await waitFor(cdp, "document.querySelector('.md') !== null", "转录区正文")
  await pause(900)
}

/** 用 CDP 发真鼠标事件，验一次按下捕获、首段拖动与松手落档。 */
export async function exerciseEffort({ value, pause }, cdp) {
  const rect = await value(cdp, `(() => {
    const r = document.querySelector('.effort__bar').getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })()`)
  const y = rect.top + rect.height / 2
  const x0 = rect.left + rect.width * 0.12
  const x1 = rect.left + rect.width * 0.86
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 })
  await pause(60)
  const pressed = await value(cdp, "Number(document.querySelector('.effort__bar').getAttribute('aria-valuenow'))")
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y, button: "left", buttons: 1 })
  await pause(80)
  const live = await value(cdp, "document.querySelector('.effort__bar--live') !== null")
  if (!live) throw new Error("推理强度滑块没有进入拖动态")
  const moved = await value(cdp, "Number(document.querySelector('.effort__bar').getAttribute('aria-valuenow'))")
  if (moved <= pressed) throw new Error("推理强度滑块没有跟随真实鼠标移动")
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 })
  await pause(160)
}
