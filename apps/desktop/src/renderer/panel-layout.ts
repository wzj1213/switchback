/** 左侧导航固定；工具组可并排，也可暂时独占右侧内容区。 */
export function panelShellClass(open: boolean, full: boolean): string {
  return `shell${open ? " shell--workbench" : ""}${open && full ? " shell--workbench-full" : ""}`
}
