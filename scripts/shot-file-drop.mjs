import { join } from "node:path"

/** 用 CDP 的真实文件列表拖进窗口；这会经过 Electron `webUtils.getPathForFile`。 */
export async function exerciseFileDrop({ value, pause }, cdp, paths, options) {
  const { target, drop = true, hint: expectedHint = "引用" } = options
  const rect = await value(
    cdp,
    `(() => {
    const r = document.querySelector('${target}').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`,
  )
  const data = { items: [], files: paths, dragOperationsMask: 1 }
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", ...rect, data })
  await pause(120)
  const hint = await value(cdp, "document.querySelector('.composer-drop')?.textContent ?? ''")
  if (!hint.includes(expectedHint)) {
    throw new Error(`文件拖入提示不符合预期（${expectedHint}）：${hint}`)
  }
  const visible = await value(
    cdp,
    `(() => {
    const hint = document.querySelector('.composer-drop span')
    if (hint === null) return false
    const box = hint.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const overlay = hint.parentElement
    const before = overlay.style.pointerEvents
    overlay.style.pointerEvents = 'auto'
    const shown = overlay.contains(document.elementFromPoint(x, y))
    overlay.style.pointerEvents = before
    return shown
  })()`,
  )
  if (!visible) throw new Error("文件拖放提示被其他界面遮住")
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", ...rect, data })
  if (!drop) return { rect, data }
  await cdp.send("Input.dispatchDragEvent", { type: "drop", ...rect, data })
  await pause(300)
  return undefined
}

export async function completeFileDrop({ pause }, cdp, held) {
  if (held === undefined) return
  await cdp.send("Input.dispatchDragEvent", { type: "drop", ...held.rect, data: held.data })
  await pause(300)
}

/** 侧栏仍不是任务落点；工具组不能把全窗口都变成接收区。 */
export async function rejectFileDrop({ value, pause }, cdp, paths, target) {
  if (target === undefined) return
  const rect = await value(
    cdp,
    `(() => {
    const r = document.querySelector('${target}').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`,
  )
  const data = { items: [], files: paths, dragOperationsMask: 1 }
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", ...rect, data })
  await pause(120)
  const hint = await value(cdp, "document.querySelector('.composer-drop')?.textContent ?? ''")
  await cdp.send("Input.dispatchDragEvent", { type: "dragCancel", ...rect, data })
  await pause(80)
  if (hint !== "") throw new Error(`侧栏被误当成文件落点：${hint}`)
}

export async function dragIntoView({ value, pause, waitFor, root }, cdp, view) {
  if (view.dragFiles === undefined) return undefined
  const paths = view.dragFiles.map((path) => join(root, path))
  await rejectFileDrop({ value, pause }, cdp, paths, view.rejectDragTarget)
  if (view.dragTarget === undefined) return undefined
  const held = await exerciseFileDrop({ value, pause }, cdp, paths, {
    target: view.dragTarget,
    drop: view.holdDrag !== true,
    ...(view.dragHint === undefined ? {} : { hint: view.dragHint }),
  })
  if (view.holdDrag === true) return held
  await waitFor(
    cdp,
    "document.querySelector('.send:not(:disabled)') !== null",
    `${view.name} 可发送态`,
  )
  return undefined
}
