export function moveKeyProps(
  onMove: ((direction: -1 | 1) => void) | undefined,
): React.HTMLAttributes<HTMLButtonElement> {
  if (onMove === undefined) return {}
  return {
    "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
    onKeyDown: (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
      event.preventDefault()
      onMove(event.key === "ArrowUp" ? -1 : 1)
    },
  }
}
