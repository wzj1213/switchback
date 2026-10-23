import { SearchIcon } from "./icons.js"
import { CloseIcon } from "./icons-panel.js"
import { SIDEBAR_ICON } from "./icon-base.js"
import { useMessages } from "../i18n.js"
import { SIDEBAR_SEARCH } from "./sidebar-search.messages.js"

export function SidebarSearch({ box, query, onQuery }: {
  box: React.RefObject<HTMLInputElement | null>
  query: string
  onQuery: (next: string) => void
}): React.JSX.Element {
  const m = useMessages(SIDEBAR_SEARCH)
  const clear = (): void => {
    onQuery("")
    box.current?.focus()
  }
  return (
    <div className="row row--search">
      <span className="row__slot"><SearchIcon size={SIDEBAR_ICON} /></span>
      <input className="sidebar__filter" ref={box} type="text" value={query}
        placeholder={m.placeholder} aria-label={m.label} aria-keyshortcuts="Meta+K Control+K"
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
        <button type="button" className="iconbtn sidebar__clear" aria-label={m.clear}
          data-tip={m.clearTip} onClick={clear}><CloseIcon size={13} /></button>
      )}
    </div>
  )
}
