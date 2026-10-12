/**
 * 这扇窗是不是远程窗口（另一台电脑从宿主的 `/desk/` 打开的那一页）。
 *
 * 远程窗口里要藏掉**只在宿主屏幕上有意义的入口**：在访达中显示、用系统编辑器打开、
 * 导出诊断、装引擎、自更新、远程访问的设置。它们点下去做的事发生在另一台机器的屏幕上，
 * 远程这头的人看不见——摆着就是一颗「点了没反应」的按钮。
 *
 * 判据就是桥上有没有 `remoteHost`（`remote/types.ts`）：本机窗口的 preload 没有这个字段。
 * 桥在第一次渲染之前就装好了，一页的生命周期里不会变，所以这里直接读、不做订阅。
 */
export function remoteHost(): string | undefined {
  return typeof window === "undefined" ? undefined : window.switchback?.remoteHost
}

export function isRemote(): boolean {
  return remoteHost() !== undefined
}
