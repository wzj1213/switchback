import { useScrollbars } from "./useScrollbars.js"
import { useShiftWatch } from "./use-shift-watch.js"

/**
 * 挂在整扇窗口上、和任何一块内容都无关的那几件事。
 *
 * 单开一个出口是因为它们有同一种失效方式：**谁都不属于**，
 * 于是每加一件就往 `App` 顶上再堆一行，而 `App` 那个函数早就贴着行数闸门。
 * 更要紧的是它们都挂 `window` 级监听——散在各处的话，
 * 「这扇窗口上到底挂了多少个 focus 监听」就再也没人答得上来。
 *
 * - `useScrollbars`：滚动条平时看不见，滚动或悬停才淡进来
 * - `useShiftWatch`：窗口回来那一下界面跳没跳，跳了就往日志里记一行
 */
export function useWindowChrome(): void {
  useScrollbars()
  useShiftWatch()
}
