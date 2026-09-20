import { SearchIcon } from "./icons.js"
import { CloseIcon } from "./icons-panel.js"
import { SIDEBAR_ICON } from "./icon-base.js"

export function SidebarSearch({ box, query, onQuery }: {
  box: React.RefObject<HTMLInputElement | null>
  query: string
  onQuery: (next: string) => void
}): React.JSX.Element {
  const clear = (): void => {
    onQuery("")
    box.current?.focus()
  }
  return (
    <div className="row row--search">
      <span className="row__slot"><SearchIcon size={SIDEBAR_ICON} /></span>
      <input className="sidebar__filter" ref={box} type="text" value={query}
        placeholder="筛选会话…" aria-label="筛选会话" aria-keyshortcuts="Meta+K Control+K"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Escape" && query !== "") {
            event.preventDefault()
            event.stopPropagation()
            clear()
          }
          if (event.key !== "ArrowDown") return
          const first = event.currentTarget.closest(".sidebar")
            ?.querySelector<HTMLButtonElement>(".sidebar__list .row__main, .sidebar__list .deep__row")
          if (first === null || first === undefined) return
          event.preventDefault()
          first.focus()
        }} />
      {query === "" ? <kbd className="sidebar__shortcut" aria-hidden="true">⌘K</kbd> : (
        <button type="button" className="iconbtn sidebar__clear" aria-label="清除会话筛选"
          data-tip="清除筛选（Esc）" onClick={clear}><CloseIcon size={13} /></button>
      )}
    </div>
  )
}
