import { useState } from "react"

interface SidebarOpen {
  isOpen: (cwd: string) => boolean
  toggle: (cwd: string) => void
  reveal: (cwd: string) => void
}

/** Keeps explicit expand/collapse choices separate from the selected-project default. */
export function useSidebarOpen(here: string | undefined): SidebarOpen {
  const [choice, setChoice] = useState<ReadonlyMap<string, boolean>>(new Map())
  const isOpen = (cwd: string): boolean => choice.get(cwd) ?? cwd === here
  const toggle = (cwd: string): void => {
    setChoice((previous) => {
      const next = new Map(previous)
      next.set(cwd, !(previous.get(cwd) ?? cwd === here))
      return next
    })
  }
  const reveal = (cwd: string): void => {
    setChoice(previous => new Map(previous).set(cwd, true))
  }
  return { isOpen, toggle, reveal }
}
