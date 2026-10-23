import { useMessages } from "../i18n.js"
import { SIDEBAR_PAGES } from "./sidebar-pages.messages.js"

export function SidebarPages({ page, pages, start, end, total, label, onPage }: {
  page: number
  pages: number
  start: number
  end: number
  total: number
  label: string
  onPage: (page: number) => void
}): React.JSX.Element | null {
  const m = useMessages(SIDEBAR_PAGES)
  if (pages <= 1) return null
  return (
    <div className="project-pages" role="group" aria-label={m.group(label)}>
      <button type="button" disabled={page === 0} aria-label={m.prevOf(label)}
        onClick={() => onPage(page - 1)}>{m.prev}</button>
      <span aria-live="polite">{start + 1}–{end} / {total}</span>
      <button type="button" disabled={page + 1 === pages} aria-label={m.nextOf(label)}
        onClick={() => onPage(page + 1)}>{m.next}</button>
    </div>
  )
}
