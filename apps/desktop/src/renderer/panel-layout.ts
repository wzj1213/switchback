/** 左侧导航固定；工具组可并排，也可暂时独占右侧内容区。 */
export function panelShellClass(open: boolean, full: boolean): string {
  return `shell${open ? " shell--workbench" : ""}${open && full ? " shell--workbench-full" : ""}`
}

/** 并排工具组不妨碍继续输入；只有实际遮住主区时，拖放完成后才收起。 */
export function shouldClosePanelAfterDrop(viewportWidth: number, full: boolean): boolean {
  return full || viewportWidth <= 1120
}
