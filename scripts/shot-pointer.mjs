const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 每屏先移出旧热区，避免基线已经处在上一屏的 hover 状态。 */
export async function resetPointer(cdp, view) {
  if (view.hover === undefined) return
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, buttons: 0 })
  await pause(150)
}

/** 真实指针驱动 :hover / :active，不能用 DOM click 或 focus 冒充。 */
export async function hoverOver(cdp, view) {
  if (view.hover === undefined) return
  const response = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const node = document.querySelector(${JSON.stringify(view.hover)})
      if (node === null) return null
      const box = node.getBoundingClientRect()
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
    })()`,
    returnByValue: true,
  })
  const at = response.result?.value
  if (at === null || at === undefined) throw new Error(`${view.name} 找不到要悬停的 ${view.hover}`)
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, buttons: 0 })
  if (view.press === true)
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 })
  await pause(view.hoverDelayMs ?? 200)
}

/** 在热区外松开，只验按下反馈，不触发点击或拖动业务动作。 */
export async function releasePointer(cdp, view) {
  if (view.press !== true) return
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1, y: 1, button: "left", buttons: 0, clickCount: 1 })
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, buttons: 0 })
}
