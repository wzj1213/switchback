/**
 * 这次按下该不该当成「选中」。
 *
 * 会话行、面板页签这类**切换**在按下那一刻就生效，不等松手：一次点击的按下到松开
 * 有八九十毫秒，切换晚这一截，整个界面就显得慢半拍（Finder、Mail 的列表也是按下即选）。
 * 只认主键、不带修饰键：右键是菜单，⌘ / ⇧ / ⌥ 点各有各的约定，不能被它抢先。
 */
export interface PressLike {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function selectsOnPress(event: PressLike): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * 行上那颗主按钮要摊的事件：开着就在按下时选中，关着什么都不加。
 * `onClick` 照旧留着：键盘的回车 / 空格走它；鼠标按下时已经选过，松手再选一次同一条什么都不变。
 */
export function pressSelect(on: boolean, select: () => void): { onPointerDown?: (event: PressLike) => void } {
  if (!on) return {}
  return {
    onPointerDown: (event) => {
      if (selectsOnPress(event)) select()
    },
  }
}
