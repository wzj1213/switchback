/** 只通过用户看得见的入口打开页面；视觉验收不碰 React 内部状态。三页固定常驻，按名字点就行。 */
export function openPanelPage(label) {
  const quoted = JSON.stringify(label)
  return [
    `if (document.querySelector('.shell--workbench') === null) {
      const toggle = document.querySelector('[aria-label="显示侧边面板"]')
      toggle?.focus(); toggle?.click()
    }`,
    `(() => {
      const panel = document.querySelector('.workbench:not([hidden]), .rv:not([hidden])')
      ;[...(panel?.querySelectorAll('.panel-tab__pick') ?? [])]
        .find(button => button.textContent.trim() === ${quoted})?.click()
    })()`,
  ]
}
