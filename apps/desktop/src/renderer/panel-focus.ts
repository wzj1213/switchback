/** 页签可能由临时菜单打开；原触发器消失时，把焦点还给持久的总入口。 */
export function restorePanelFocus(origin: HTMLElement | undefined): void {
  // preventScroll：还焦这一帧抽屉可能还在滑，focus 默认的 scroll-into-view
  // 会把列宽过渡强制走完（实测见 use-panel-keys.ts 那段）
  if (origin?.isConnected === true) {
    origin.focus({ preventScroll: true })
    return
  }
  // 认 class 不认读屏名：读屏名随界面语言变，按名字找会在英文界面上找不到
  document.querySelector<HTMLElement>(".paneltoggle")?.focus({ preventScroll: true })
}
