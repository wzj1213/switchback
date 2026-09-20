export function SidebarPages({ page, pages, start, end, total, label, onPage }: {
  page: number
  pages: number
  start: number
  end: number
  total: number
  label: string
  onPage: (page: number) => void
}): React.JSX.Element | null {
  if (pages <= 1) return null
  return (
    <div className="project-pages" role="group" aria-label={`${label}翻页`}>
      <button type="button" disabled={page === 0} aria-label={`上一页${label}`}
        onClick={() => onPage(page - 1)}>上一页</button>
      <span aria-live="polite">{start + 1}–{end} / {total}</span>
      <button type="button" disabled={page + 1 === pages} aria-label={`下一页${label}`}
        onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  )
}
