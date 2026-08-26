/** 用 CDP 的真实文件列表拖进 composer；这会经过 Electron `webUtils.getPathForFile`。 */
export async function exerciseFileDrop({ value, pause }, cdp, paths) {
  const rect = await value(cdp, `(() => {
    const r = document.querySelector('.composer__inner').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  const data = { items: [], files: paths, dragOperationsMask: 1 }
  await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", ...rect, data })
  await pause(120)
  const hint = await value(cdp, "document.querySelector('.composer-drop')?.textContent ?? ''")
  if (!hint.includes("引用")) throw new Error(`文件拖入没有给可放提示：${hint}`)
  await cdp.send("Input.dispatchDragEvent", { type: "dragOver", ...rect, data })
  await cdp.send("Input.dispatchDragEvent", { type: "drop", ...rect, data })
  await pause(300)
}
