/**
 * 外壳的三档：左侧导航在不在、工具组并排还是独占。
 *
 * `rail` 是**用户显式收起的那一档**，和 1280px 以下那条媒体查询不是一回事：
 * 后者只在「工作台开着」时才自动收导航（否则会话被夹在中间没地方站），
 * 而这一档任何时候都成立——窗口再宽，不想要它就能收起来。
 */
export function panelShellClass(open: boolean, full: boolean, rail = true): string {
  return `shell${rail ? "" : " shell--norail"}${open ? " shell--workbench" : ""}${open && full ? " shell--workbench-full" : ""}`
}

/** 并排工具组不妨碍继续输入；只有实际遮住主区时，拖放完成后才收起。 */
export function shouldClosePanelAfterDrop(viewportWidth: number, full: boolean, rail = true): boolean {
  return full || viewportWidth <= (rail ? 1240 : 1040)
}
