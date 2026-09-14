/** 与 .source-line 的 22px 行高一致。长文件只挂载视口附近的行。 */
export const SOURCE_LINE_HEIGHT = 22

export function sourceWindow(count: number, scroll: number, height: number): { start: number; end: number } {
  if (count <= 3000) return { start: 0, end: count }
  const start = Math.max(0, Math.min(count - 1, Math.floor(Math.max(0, scroll) / SOURCE_LINE_HEIGHT) - 30))
  return { start, end: Math.min(count, start + Math.ceil(Math.max(0, height) / SOURCE_LINE_HEIGHT) + 90) }
}
