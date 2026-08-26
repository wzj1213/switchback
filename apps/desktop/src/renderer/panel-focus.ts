/** 页签可能由临时菜单打开；原触发器消失时，把焦点还给持久的总入口。 */
export function restorePanelFocus(origin: HTMLElement | undefined): void {
  if (origin?.isConnected === true) {
    origin.focus()
    return
  }
  document.querySelector<HTMLElement>('[aria-label="显示侧边面板"]')?.focus()
}
