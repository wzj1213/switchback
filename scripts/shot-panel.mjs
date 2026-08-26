/** 只通过用户看得见的入口打开页签；视觉验收不碰 React 内部状态。 */
export function openPanelPage(label) {
  const quoted = JSON.stringify(label)
  return [
    `if (document.querySelector('.shell--workbench') === null) {
      const toggle = document.querySelector('[aria-label="显示侧边面板"]')
      toggle?.focus(); toggle?.click()
    }`,
    `(() => {
      const panel = document.querySelector('.workbench:not([hidden]), .rv:not([hidden])')
      const tab = [...(panel?.querySelectorAll('.panel-tab__pick') ?? [])]
        .find(button => button.textContent.trim() === ${quoted})
      if (tab !== undefined) tab.click()
      else panel?.querySelector('[aria-label="新建侧边页面"]')?.click()
    })()`,
    `if (document.querySelector('[role="menu"][aria-label="新建侧边页面"]') !== null)
      [...document.querySelectorAll('.pop__item')]
        .find(button => button.querySelector('.pop__label')?.textContent.trim() === ${quoted})?.click()`,
    `(() => {
      const panel = document.querySelector('.workbench:not([hidden]), .rv:not([hidden])')
      ;[...(panel?.querySelectorAll('.panel-tab__pick') ?? [])]
        .find(button => button.textContent.trim() === ${quoted})?.click()
    })()`,
  ]
}
