/** 候选浮层确认键：Shift+Tab 必须保留给反向离开，输入法组合期间也不接管。 */
export function acceptsCompletion(key: string, shiftKey: boolean, composing: boolean): boolean {
  if (composing) return false
  return key === "Enter" || (key === "Tab" && !shiftKey)
}
