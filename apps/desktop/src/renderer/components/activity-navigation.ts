export function activityRowDestination(
  key: string,
  at: number,
  total: number,
): number | undefined {
  if (total === 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return undefined
  if (key === "Home") return 0
  if (key === "End") return total - 1
  if (key === "ArrowUp") return Math.max(0, at - 1)
  return Math.min(at + 1, total - 1)
}

function focusRow(row: HTMLButtonElement | undefined): boolean {
  if (row === undefined) return false
  row.focus()
  row.scrollIntoView({ block: "nearest" })
  return true
}

function rowsOf(root: Element | null): readonly HTMLButtonElement[] {
  return [...(root?.querySelectorAll<HTMLButtonElement>(".activity-row:not(:disabled)") ?? [])]
}

export function focusActivity(root: Element | null, laneId: string): boolean {
  return focusRow(rowsOf(root).find((row) => row.dataset.laneId === laneId))
}

export function focusFirstActivity(root: Element | null): boolean {
  return focusRow(rowsOf(root)[0])
}

export function moveActivityFocus(event: React.KeyboardEvent<HTMLButtonElement>): void {
  const root = event.currentTarget.closest(".activity-list")
  const rows = rowsOf(root)
  const destination = activityRowDestination(event.key, rows.indexOf(event.currentTarget), rows.length)
  if (destination === undefined) return
  event.preventDefault()
  focusRow(rows[destination])
}
