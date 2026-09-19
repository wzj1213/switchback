/** 真实 Chromium 拖动；不用合成 DOM 事件替代平台 dragstart/drop。 */
export async function dragSidebar({ value, pause }, cdp, spec) {
  if (spec === undefined) return
  const locate = text => `(() => {
    const row = [...document.querySelectorAll('.row--thread')]
      .find(row => row.querySelector('.row__label')?.textContent === ${JSON.stringify(text)})
    if (!row) throw new Error('找不到拖动行')
    row.scrollIntoView({ block: 'nearest' })
    const r = row.getBoundingClientRect()
    return { x: r.left + 55, top: r.top, height: r.height }
  })()`
  const from = await value(cdp, locate(spec.from))
  const to = await value(cdp, locate(spec.to))
  const start = { x: from.x, y: from.top + from.height / 2 }
  const end = { x: to.x, y: to.top + to.height * (spec.edge === "after" ? 0.8 : 0.2) }
  let cancel
  const intercepted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cancel?.(); reject(new Error("没有产生原生拖动")) }, 4000)
    cancel = cdp.on("Input.dragIntercepted", data => { clearTimeout(timer); resolve(data.data) })
  })
  await cdp.send("Input.setInterceptDrags", { enabled: true })
  try {
    await cdp.send("Input.dispatchMouseEvent", { ...start, type: "mousePressed", button: "left", clickCount: 1 })
    await cdp.send("Input.dispatchMouseEvent", { x: start.x + 12, y: start.y + 2, type: "mouseMoved", button: "left", buttons: 1 })
    await cdp.send("Input.dispatchMouseEvent", { ...end, type: "mouseMoved", button: "left", buttons: 1 })
    const data = await intercepted
    await cdp.send("Input.dispatchDragEvent", { ...end, type: "dragEnter", data })
    await cdp.send("Input.dispatchDragEvent", { ...end, type: "dragOver", data })
    await pause(120)
    const edge = await value(cdp, `document.querySelector('.row--dropping')?.dataset.dropEdge`)
    if (edge !== spec.edge) throw new Error(`落点不匹配：${edge} / ${spec.edge}`)
    await cdp.send("Input.dispatchDragEvent", { ...end, type: "drop", data })
    await cdp.send("Input.dispatchMouseEvent", { ...end, type: "mouseReleased", button: "left", clickCount: 1 })
    await pause(300)
  } finally {
    cancel?.()
    await cdp.send("Input.setInterceptDrags", { enabled: false })
  }
}
