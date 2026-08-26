export function reviewDestination(key: string, at: number, total: number): number | undefined {
  if (total === 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return undefined
  if (key === "Home") return 0
  if (key === "End") return total - 1
  if (at < 0) return key === "ArrowUp" ? total - 1 : 0
  if (key === "ArrowUp") return (at - 1 + total) % total
  return (at + 1) % total
}
