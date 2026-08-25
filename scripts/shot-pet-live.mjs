/**
 * 在隔离数据目录里新开一条真实 Claude 会话。只给视觉验收用：不碰用户历史，
 * 也不靠伪造 delta——枪的节奏和挂点必须经过和产品相同的桥与 canvas。
 */
export async function openPetLive(control, cdp) {
  const { value, waitFor, pause } = control
  await value(cdp, `document.querySelector('.sidebar__new')?.click(); true`)
  await waitFor(
    cdp,
    `document.querySelector('.composer__input:not([disabled])') !== null`,
    "Claude 新会话输入框",
  )
  await value(cdp, `(() => {
    const input = document.querySelector('.composer__input')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    set?.call(input, '请从 1 数到 500，每个数字单独一行，只输出数字，不要使用工具。')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(cdp, `document.querySelector('.send:not([disabled])') !== null`, "发送键")
  await value(cdp, `document.querySelector('.send')?.click(); true`)
  await waitFor(cdp, `document.querySelector('.send--stop') !== null`, "Claude 正在输出")
  await waitFor(
    cdp,
    `[...document.querySelectorAll('.msg--agent .md')].some(x => x.textContent.trim().length > 40)`,
    "Claude 已进入持续逐字输出",
  )
  await pause(120)
}
