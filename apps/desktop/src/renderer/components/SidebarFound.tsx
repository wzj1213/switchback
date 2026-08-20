import type { useDeepSearch } from "../useDeepSearch.js"
import type { SidebarRow } from "../sidebar.js"
import { Deep } from "./SidebarDeep.js"
import { Hits } from "./SidebarHits.js"
import type { RenameCtl } from "./RowName.js"

interface FoundHandlers {
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  rowMenu: (event: React.MouseEvent, row: SidebarRow, arm: () => void, rename: () => void) => void
  rename: RenameCtl
}

export function SidebarFound({
  rows,
  found,
  deep,
  selectedId,
  on,
}: {
  rows: readonly SidebarRow[]
  found: readonly SidebarRow[]
  deep: ReturnType<typeof useDeepSearch>
  selectedId: string
  on: FoundHandlers
}): React.JSX.Element {
  return (
    <>
      <Hits rows={found} total={rows.length} selectedId={selectedId} on={on} />
      <Deep
        hits={deep.hits}
        rows={rows}
        shown={new Set(found.map((row) => row.thread.id))}
        selectedId={selectedId}
        busy={deep.busy}
        skipped={deep.skipped}
        onSelect={on.onSelect}
      />
    </>
  )
}
