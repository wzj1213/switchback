/** 导航开合与工具组是否独占都由用户决定，窗口尺寸不改变这两项选择。 */
export function panelShellClass(open: boolean, full: boolean, rail = true): string {
  return `shell${rail ? "" : " shell--norail"}${open ? " shell--workbench" : ""}${open && full ? " shell--workbench-full" : ""}`
}
