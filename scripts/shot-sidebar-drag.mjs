/**
 * 真实 Chromium 拖动；不用合成 DOM 事件替代平台 dragstart/drop。
 *
 * 落点两种：`to` 是一行会话（按 `edge` 落在它前半或后半）；`toSelector` 是一块区域
 * （例如空置顶拖动时才浮出来的落点），落在它正中。**落点要等拖动开始之后才找**——
 * 浮出来的那种在拖起来之前根本不在 DOM 里。
 */
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
  const area = selector => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) throw new Error('找不到落点 ' + ${JSON.stringify(selector)})
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, top: r.top, height: r.height }
  })()`
  const from = await value(cdp, locate(spec.from))
  const start = { x: from.x, y: from.top + from.height / 2 }
  let cancel
  const intercepted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cancel?.(); reject(new Error("没有产生原生拖动")) }, 4000)
    cancel = cdp.on("Input.dragIntercepted", data => { clearTimeout(timer); resolve(data.data) })
  })
  await cdp.send("Input.setInterceptDrags", { enabled: true })
  try {
    await cdp.send("Input.dispatchMouseEvent", { ...start, type: "mousePressed", button: "left", clickCount: 1 })
    await cdp.send("Input.dispatchMouseEvent", { x: start.x + 12, y: start.y + 2, type: "mouseMoved", button: "left", buttons: 1 })
    const toward = spec.toSelector === undefined ? await value(cdp, locate(spec.to)) : undefined
    if (toward !== undefined) {
      const y = toward.top + toward.height * (spec.edge === "after" ? 0.8 : 0.2)
      await cdp.send("Input.dispatchMouseEvent", { x: toward.x, y, type: "mouseMoved", button: "left", buttons: 1 })
    }
    const data = await intercepted
    await pause(60)
    const to = toward ?? await value(cdp, area(spec.toSelector))
    const end = spec.toSelector === undefined
      ? { x: to.x, y: to.top + to.height * (spec.edge === "after" ? 0.8 : 0.2) }
      : { x: to.x, y: to.top + to.height / 2 }
    await cdp.send("Input.dispatchDragEvent", { ...end, type: "dragEnter", data })
    await cdp.send("Input.dispatchDragEvent", { ...end, type: "dragOver", data })
    await pause(120)
    if (spec.toSelector === undefined) {
      const edge = await value(cdp, `document.querySelector('.row--dropping')?.dataset.dropEdge`)
      if (edge !== spec.edge) throw new Error(`落点不匹配：${edge} / ${spec.edge}`)
    }
    await cdp.send("Input.dispatchDragEvent", { ...end, type: "drop", data })
    await cdp.send("Input.dispatchMouseEvent", { ...end, type: "mouseReleased", button: "left", clickCount: 1 })
    await pause(300)
  } finally {
    cancel?.()
    await cdp.send("Input.setInterceptDrags", { enabled: false })
  }
}
