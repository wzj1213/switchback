/** 把固定样本点开；反复确认展开态，扛住启动期侧栏的异步重绘。 */
export async function openFixture({ value, waitFor, pause }, cdp) {
  const group = `[...document.querySelectorAll('.row--group')].find(row => row.querySelector('.row__label')?.textContent.trim() === 'omni')`
  await waitFor(cdp, `${group}?.querySelector('.row__main') !== null`, "项目组")
  const deadline = Date.now() + 20_000
  let selected = false
  while (!selected) {
    if (Date.now() >= deadline) throw new Error("界面没有就绪（会话列表）")
    // 展开与否看组里有没有会话行——组头的展开箭头已按拍板换成开/合文件夹图标，
    // 没有 `.chev--open` 可问了（见 SidebarGroup.tsx）
    if (!(await value(cdp, `${group}?.parentElement?.querySelector('.row--thread .row__main') !== null`))) {
      await value(cdp, `${group}?.querySelector('.row__main')?.click(); true`)
    }
    selected = await value(
      cdp,
      `(() => {
      const row = document.querySelector('.row--thread .row__main')
      if (row === null) return false
      row.click()
      return true
    })()`,
    )
    await pause(120)
  }
  await waitFor(cdp, "document.querySelector('.md') !== null", "转录区正文")
  await pause(900)
}

/** 用 CDP 发真鼠标事件，验一次按下捕获、首段拖动与松手落档。 */
export async function exerciseEffort({ value, pause }, cdp) {
  const rect = await value(
    cdp,
    `(() => {
    const r = document.querySelector('.effort__bar').getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })()`,
  )
  const viewport = await value(cdp, "window.innerWidth")
  if (rect.left < 0 || rect.left + rect.width > viewport) {
    throw new Error(`推理强度滑块越出窗口：${JSON.stringify({ rect, viewport })}`)
  }
  const y = rect.top + rect.height / 2
  const x0 = rect.left + rect.width * 0.12
  const x1 = rect.left + rect.width * 0.86
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: x0,
    y,
    button: "left",
    clickCount: 1,
  })
  await pause(60)
  const pressed = await value(
    cdp,
    "Number(document.querySelector('.effort__bar').getAttribute('aria-valuenow'))",
  )
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: x1,
    y,
    button: "left",
    buttons: 1,
  })
  await pause(80)
  const live = await value(cdp, "document.querySelector('.effort__bar--live') !== null")
  if (!live) throw new Error("推理强度滑块没有进入拖动态")
  const moved = await value(
    cdp,
    "Number(document.querySelector('.effort__bar').getAttribute('aria-valuenow'))",
  )
  if (moved <= pressed) throw new Error("推理强度滑块没有跟随真实鼠标移动")
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x1,
    y,
    button: "left",
    clickCount: 1,
  })
  await pause(40)
  await collapsesToDraggedLevel({ value, pause }, cdp)
  await pause(160)
}

/**
 * **松手之后马上收起，收起来的那颗要写着刚落的那一档。**
 *
 * 上一版不是这样：「已落档、还没等到引擎回声」那份本地状态住在展开的条子里，
 * 条子一收就卸载了，于是触发器退回 `thread.effort`——也就是**你刚刚亲手改掉的
 * 那一档**。而 `thread.setModel` 要进宿主的串行队列、再 await 引擎自己的 setter，
 * 实测那是好几秒；这几秒里界面在撒谎。
 *
 * 所以这里故意**不等回声**：松手 40ms 就点走，再等过收回动画（190ms）立刻读。
 * 引擎的回声几乎不可能这么快到，读到的只能是本地那份乐观档位。
 */
async function collapsesToDraggedLevel({ value, pause }, cdp) {
  const wanted = await value(
    cdp,
    "document.querySelector('.effort__bar')?.getAttribute('aria-valuetext') ?? ''",
  )
  const away = await value(
    cdp,
    `(() => { const r = document.querySelector('.transcript').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + 40 } })()`,
  )
  await cdp.send("Input.dispatchMouseEvent", { ...away, type: "mousePressed", button: "left", clickCount: 1 })
  await cdp.send("Input.dispatchMouseEvent", { ...away, type: "mouseReleased", button: "left", clickCount: 1 })
  await pause(240)
  const shown = await value(cdp, "document.querySelector('.effort .trigger__label')?.textContent ?? ''")
  if (shown !== wanted) {
    throw new Error(`收起后的推理强度还是旧档位：条子上是「${wanted}」，收起来写着「${shown}」`)
  }
  await value(cdp, "document.querySelector('.effort .trigger:not(:disabled)')?.click(); true")
  await pause(360)
}
